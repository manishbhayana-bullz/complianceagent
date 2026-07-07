/**
 * MILESTONE 2 — compare_obligations
 * ----------------------------------
 * Proves: given two circulars' extracted obligations, the agent returns
 * structured conflicts[]/no_change_areas[]/summary — and this same logic
 * is wired TWO ways:
 *   (a) as a tool the Milestone-1 orchestrator can call mid-conversation
 *   (b) as a standalone trigger that fires automatically at ingest time
 *
 * FINAL RECONCILED SCHEMA (supersedes Prompt 3.1's nature enum AND
 * Prompt 3.2's missing nature field — pick this as the single source
 * of truth and update both prompts in your library to match):
 *
 *   nature: "supersedes" | "amends" | "contradicts" |
 *           "tightened"  | "overlaps_with_gap"
 *
 *   - supersedes        -> explicit supersession language exists
 *   - amends            -> explicit partial-amendment language exists
 *   - contradicts       -> same obligation, genuinely incompatible requirements,
 *                          no supersession/amendment language stated
 *   - tightened         -> same obligation, B imposes a stricter version
 *                          (shorter deadline, lower threshold, higher penalty)
 *                          -- not ambiguous, just harder
 *   - overlaps_with_gap -> both address the topic but neither text says
 *                          which one a bank should follow
 */

const MODEL = "claude-sonnet-5"; // use your account's current model string — check docs.claude.com if this errors

// ---------------------------------------------------------------------------
// 1. TOOL DEFINITION — this is what you register with the orchestrator
//    (the Milestone-1 agent loop). Anthropic tool-use format.
// ---------------------------------------------------------------------------
const compareObligationsToolDef = {
  name: "compare_obligations",
  description:
    "Compare obligations extracted from two regulatory circulars covering " +
    "overlapping topics. Returns structured conflicts, no-change areas, and " +
    "a plain-English summary. Use this whenever the user asks about a change " +
    "between two circulars, or whenever two circulars share subject_tags.",
  input_schema: {
    type: "object",
    properties: {
      circular_a: {
        type: "object",
        properties: {
          doc_id: { type: "string" },
          title: { type: "string" },
          domain: { type: "string" },
          date_issued: { type: "string" },
          obligations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                text: { type: "string" },
                clause_ref: { type: "string" },
                deadline: { type: "string" },
              },
              required: ["id", "text"],
            },
          },
        },
        required: ["doc_id", "title", "obligations"],
      },
      circular_b: { $ref: "#/properties/circular_a" }, // same shape
    },
    required: ["circular_a", "circular_b"],
  },
};

// ---------------------------------------------------------------------------
// 2. SYSTEM PROMPT — the reconciled version of Prompt 3.2, with the
//    nature enum fixed and clause_ref citation enforced.
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are ComplianceAgent's conflict-detection module. You are given
obligations extracted from two regulatory circulars that cover overlapping
topics. Identify where they conflict, where one supersedes or amends the
other, and where they address the same topic with no material difference.

Rules:
- Compare obligation-by-obligation, not document-by-document generalities.
- Classify each conflict's "nature" as exactly one of:
  "supersedes" | "amends" | "contradicts" | "tightened" | "overlaps_with_gap"
- "takes_precedence": name which circular to follow and why in one clause
  (explicit supersession language, later date, stricter-therefore-safer rule).
  If undeterminable from the text, say "unclear — requires manual review".
- "action_required": one concrete next step for a compliance officer.
- "no_change_areas": topics both circulars address with no material difference.
- Never invent an obligation not present in the provided text.
- Cite clause_ref for both circulars wherever available.
- If the circulars don't overlap on any topic, return empty conflicts[] and
  say so in the summary — do not force a conflict.

Respond with ONLY a single JSON object, no markdown fences, no prose outside it:
{
  "conflicts": [
    {
      "topic": "...",
      "nature": "supersedes|amends|contradicts|tightened|overlaps_with_gap",
      "circular_a_position": "... (with clause_ref)",
      "circular_b_position": "... (with clause_ref)",
      "takes_precedence": "...",
      "action_required": "..."
    }
  ],
  "no_change_areas": ["..."],
  "summary": "2-3 sentence plain-English executive summary for a compliance officer"
}`;

// ---------------------------------------------------------------------------
// 3. CORE FUNCTION — callable directly, OR as the tool's execution handler
// ---------------------------------------------------------------------------
async function compareObligations(circularA, circularB, apiKey) {
  const userMessage = `Circular A: "${circularA.title}" (doc_id: ${circularA.doc_id}, domain: ${circularA.domain || "unspecified"})
Obligations:
${circularA.obligations.map((o, i) => `${i + 1}. [${o.clause_ref || o.id}] ${o.text}`).join("\n")}

Circular B: "${circularB.title}" (doc_id: ${circularB.doc_id}, domain: ${circularB.domain || "unspecified"})
Obligations:
${circularB.obligations.map((o, i) => `${i + 1}. [${o.clause_ref || o.id}] ${o.text}`).join("\n")}

Compare these and identify conflicts, precedence, and no-change areas per your instructions.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const rawText = data.content.map((b) => (b.type === "text" ? b.text : "")).join("");

  let parsed;
  try {
    parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
  } catch (err) {
    // Fail loudly, don't silently return garbage to a compliance UI
    throw new Error(`compare_obligations returned non-JSON: ${rawText.slice(0, 300)}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// 4. INGEST-TIME AUTO-TRIGGER
//    Call this the moment a new circular finishes Phase-1 extraction.
//    It decides WHETHER to run compare_obligations, against WHICH existing
//    circulars, without any user asking a question.
// ---------------------------------------------------------------------------
async function checkForConflictsOnIngest(newCircular, existingCircularsInSameDomain, apiKey) {
  // Trigger condition: same domain AND at least one overlapping subject_tag.
  // This is the logic your roadmap doc never specified — without it you'd
  // either compare every new circular against every old one (expensive,
  // noisy) or never trigger at all (silent gaps).
  const candidates = existingCircularsInSameDomain.filter((existing) => {
    const sameDomain = existing.domain === newCircular.domain;
    const tagOverlap =
      (existing.subject_tags || []).some((t) => (newCircular.subject_tags || []).includes(t));
    return sameDomain && tagOverlap;
  });

  const results = [];
  for (const existing of candidates) {
    const result = await compareObligations(newCircular, existing, apiKey);
    results.push({
      compared_against: existing.doc_id,
      ...result,
    });
    // Store `results` in Supabase against newCircular.doc_id here.
    // Surface any non-empty conflicts[] as a warning badge in the UI —
    // this is what makes ingest-time detection feel "agentic" rather
    // than something the user had to go ask for.
  }
  return results;
}

// ---------------------------------------------------------------------------
// 5. SMOKE TEST — run with: ANTHROPIC_API_KEY=sk-... node milestone2_compare_obligations.js
//    Uses clearly-labeled FICTIONAL test circulars, not real regulation.
// ---------------------------------------------------------------------------
async function smokeTest() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("Set ANTHROPIC_API_KEY to run the smoke test.");
    return;
  }

  const circA = {
    doc_id: "TEST-CIRC-A",
    title: "[FICTIONAL TEST] Customer Data Retention Circular v1",
    domain: "data_governance",
    subject_tags: ["Data", "KYC"],
    obligations: [
      { id: "A1", clause_ref: "Para 4.2", text: "Banks must retain customer KYC records for 5 years after account closure." },
      { id: "A2", clause_ref: "Para 5.1", text: "Banks must report data breaches to the regulator within 72 hours of detection." },
    ],
  };
  const circB = {
    doc_id: "TEST-CIRC-B",
    title: "[FICTIONAL TEST] Customer Data Retention Circular v2 (amendment)",
    domain: "data_governance",
    subject_tags: ["Data", "KYC"],
    obligations: [
      { id: "B1", clause_ref: "Para 2.1", text: "This circular amends Para 4.2 of the prior circular: retention period is extended to 8 years after account closure." },
      { id: "B2", clause_ref: "Para 3.4", text: "Banks must report data breaches to the regulator within 24 hours of detection." },
    ],
  };

  console.log("--- Testing as direct tool call (Milestone 2 core) ---");
  const conflictResult = await compareObligations(circA, circB, apiKey);
  console.log(JSON.stringify(conflictResult, null, 2));

  console.log("\n--- Testing as ingest-time auto-trigger ---");
  const ingestResult = await checkForConflictsOnIngest(circB, [circA], apiKey);
  console.log(JSON.stringify(ingestResult, null, 2));

  console.log("\n--- Testing the empty-conflict guardrail (unrelated circulars) ---");
  const circC = {
    doc_id: "TEST-CIRC-C",
    title: "[FICTIONAL TEST] Branch Signage Guidelines",
    domain: "operations",
    subject_tags: ["Branding"],
    obligations: [{ id: "C1", clause_ref: "Para 1.1", text: "Branch signage must display the bank's logo in a specific color scheme." }],
  };
  const noOverlapResult = await compareObligations(circA, circC, apiKey);
  console.log(JSON.stringify(noOverlapResult, null, 2));
}

module.exports = { compareObligationsToolDef, compareObligations, checkForConflictsOnIngest };

if (require.main === module) {
  smokeTest().catch((err) => console.error(err));
}
