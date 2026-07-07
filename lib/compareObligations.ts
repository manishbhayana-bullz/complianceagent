// lib/compareObligations.ts
//
// TEMPORARY: this still calls the Anthropic API directly with fetch().
// TODO once lib/llm.ts contents are shared: replace callClaude() below
// with your existing wrapper so there's ONE way to call Claude in this repo,
// not two. Search for "TODO(merge)" to find the exact spot.

const MODEL = "claude-sonnet-5"; // confirm this matches the model string your lib/llm.ts already uses

// ---------------------------------------------------------------------------
// Types — this is what TypeScript was missing. Once you see this pattern,
// you'll recognize it everywhere: every function needs its inputs/outputs
// described as a `type` or `interface` up front.
// ---------------------------------------------------------------------------
export interface Obligation {
  id: string;
  text: string;
  clause_ref?: string;
  deadline?: string;
}

export interface Circular {
  doc_id: string;
  title: string;
  domain?: string;
  subject_tags?: string[];
  obligations: Obligation[];
}

export interface Conflict {
  topic: string;
  nature: "supersedes" | "amends" | "contradicts" | "tightened" | "overlaps_with_gap";
  circular_a_position: string;
  circular_b_position: string;
  takes_precedence: string;
  action_required: string;
}

export interface CompareResult {
  conflicts: Conflict[];
  no_change_areas: string[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Tool definition — register this in lib/agent.ts's tool list
// ---------------------------------------------------------------------------
export const compareObligationsToolDef = {
  name: "compare_obligations",
  description:
    "Compare obligations extracted from two regulatory circulars covering " +
    "overlapping topics. Returns structured conflicts, no-change areas, and " +
    "a plain-English summary. Use this whenever the user asks about a change " +
    "between two circulars, or whenever two circulars share subject_tags.",
  input_schema: {
    type: "object",
    properties: {
      circular_a: { type: "object", description: "Circular A with its obligations array" },
      circular_b: { type: "object", description: "Circular B with its obligations array" },
    },
    required: ["circular_a", "circular_b"],
  },
} as const;

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

function formatObligations(circular: Circular): string {
  return circular.obligations
    .map((o, i) => `${i + 1}. [${o.clause_ref || o.id}] ${o.text}`)
    .join("\n");
}

// TODO(merge): replace this whole function body with a call to your
// existing lib/llm.ts wrapper once you share it — this raw fetch is a
// stand-in only, not meant to be the permanent way this repo calls Claude.
async function callClaude(systemPrompt: string, userMessage: string, apiKey: string): Promise<string> {
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
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return data.content
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");
}

export async function compareObligations(
  circularA: Circular,
  circularB: Circular,
  apiKey: string
): Promise<CompareResult> {
  const userMessage = `Circular A: "${circularA.title}" (doc_id: ${circularA.doc_id}, domain: ${circularA.domain || "unspecified"})
Obligations:
${formatObligations(circularA)}

Circular B: "${circularB.title}" (doc_id: ${circularB.doc_id}, domain: ${circularB.domain || "unspecified"})
Obligations:
${formatObligations(circularB)}

Compare these and identify conflicts, precedence, and no-change areas per your instructions.`;

  const rawText = await callClaude(SYSTEM_PROMPT, userMessage, apiKey);

  let parsed: CompareResult;
  try {
    parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
  } catch (err) {
    throw new Error(`compare_obligations returned non-JSON: ${rawText.slice(0, 300)}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Ingest-time auto-trigger — call from app/api/ingest/ after extraction
// ---------------------------------------------------------------------------
export interface ConflictCheckResult extends CompareResult {
  compared_against: string;
}

export async function checkForConflictsOnIngest(
  newCircular: Circular,
  existingCircularsInSameDomain: Circular[],
  apiKey: string
): Promise<ConflictCheckResult[]> {
  const candidates = existingCircularsInSameDomain.filter((existing) => {
    const sameDomain = existing.domain === newCircular.domain;
    const tagOverlap = (existing.subject_tags || []).some((t) =>
      (newCircular.subject_tags || []).includes(t)
    );
    return sameDomain && tagOverlap;
  });

  const results: ConflictCheckResult[] = [];
  for (const existing of candidates) {
    const result = await compareObligations(newCircular, existing, apiKey);
    results.push({ compared_against: existing.doc_id, ...result });
    // Insert into your circular_conflicts table here.
  }
  return results;
}
