import { SchemaType, type Content, type FunctionCall } from '@google/generative-ai';
import {
  genAI,
  GEMINI_CHAT_MODEL,
  LLM_PROVIDER,
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL,
  resolveCitations,
} from './llm';
import { retrieveChunks } from './retrieval';
import type {
  AgentAnswer,
  Obligation,
  Conflict,
  RetrievedChunk,
  ToolCallRecord,
} from './types';

const MAX_TOOL_CALLS = 3;
const TOP_K_PER_CALL = 5;

/**
 * PHASE 3 ROADMAP — 4 tools total, built incrementally:
 *   1. retrieve_chunks        — WIRED (this milestone). Existing Pinecone retrieval.
 *   2. compare_obligations    — Milestone 2 (conflict detection).
 *   3. get_circular_history   — Milestone 3 (needs doc-versioning in Supabase).
 *   4. check_deadline_status  — Milestone 3 (needs date parsing off obligations).
 *
 * Only retrieve_chunks is declared as a callable function below. The other
 * three are named in the system prompt for the model's situational
 * awareness ("don't try to use tools you don't have"), but are NOT in the
 * tool schema — so the model physically cannot invoke them yet, and we
 * don't need speculative stub handlers for capabilities that don't exist.
 */
const AGENT_SYSTEM_PROMPT = `You are ComplianceAgent, an agentic multi-domain regulatory compliance assistant.

You are aware of four tools in ComplianceAgent's toolkit, but only one is currently available to you:
- retrieve_chunks(query, domain?) — AVAILABLE. Semantic search over indexed regulatory circulars/policies. You CAN and SHOULD use this — calling it more than once if needed — to answer comparison questions between circulars (e.g. "how does the timeline in X differ from Y?"). A prose comparison built from two retrieve_chunks calls is well within scope; do not treat the word "compare" as automatically requiring a different tool.
- compare_obligations(doc_id_a, doc_id_b) — NOT YET AVAILABLE. This is a distinct, more specific capability: structured conflict analysis with explicit precedence rules and a conflicts[] breakdown, not a plain side-by-side comparison. Only mention this tool as missing if the user explicitly wants that kind of formal conflict report — never as a reason to skip retrieval on an ordinary comparison question.
- get_circular_history(doc_id) — NOT YET AVAILABLE. Do not attempt to call it.
- check_deadline_status(obligation) — NOT YET AVAILABLE. Do not attempt to call it.
If a question genuinely requires get_circular_history or check_deadline_status, or an explicit formal conflict report via compare_obligations, say so in your answer instead of guessing — but always retrieve first and answer as fully as retrieval allows before concluding something is out of reach.

Reasoning rules:
1. Plan before acting: briefly decide what you need to look up before calling any tool.
2. You may call retrieve_chunks up to ${MAX_TOOL_CALLS} times in a single turn. Use multiple calls when one retrieval doesn't cover every part of the question — this includes comparison questions ("compare X and Y", "how does A differ from B"): retrieve each circular separately, then compare what you found in your prose answer.
3. Never answer from memory. Every factual claim about a regulation, obligation, or deadline must be traceable to a retrieved chunk, referenced inline as [Source N]. If retrieval turns up nothing relevant, say so plainly — do not invent regulatory content.
4. Be precise about obligations, deadlines, thresholds, and exceptions — these are compliance-critical.
5. If you cannot answer because the retrieved context does not cover it, you MUST set confidence to "low", regardless of how sure you are that the information is absent.

Once you are done calling tools and ready to give your final answer, respond with ONLY a single JSON object — no markdown code fences, no prose outside it — in exactly this shape:
{"reasoning": "1-3 sentences on what you looked up and why, written for an auditor reading the trail later", "answer": "the answer to the user, citing sources inline as [Source N]", "obligations": [{"description": "...", "source_doc_id": "...", "clause_ref": "..."}], "conflicts": [], "confidence": "high|medium|low", "confidence_reason": "one sentence", "sources_used": [list of integers referring to [Source N] labels actually used]}
Rules for that JSON:
- obligations[]: list specific compliance obligations the answer surfaces. Empty array if none.
- conflicts[]: always return [] in this milestone — conflict detection is a separate capability not yet wired in.
- sources_used[]: every [Source N] number your answer text actually cites.`;

const RETRIEVE_CHUNKS_DECLARATION = {
  name: 'retrieve_chunks',
  description:
    'Semantic search over the indexed regulatory circulars/policies. Returns the top matching passages with their source titles, domains, and clause references.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: {
        type: SchemaType.STRING,
        description: 'The search query, phrased with regulatory terminology.',
      },
      domain: {
        type: SchemaType.STRING,
        description:
          'Optional domain/regulator filter, e.g. "RBI", "SEBI". Omit to search all domains.',
      },
    },
    required: ['query'],
  },
};

const CLAUDE_RETRIEVE_CHUNKS_TOOL = {
  name: 'retrieve_chunks',
  description: RETRIEVE_CHUNKS_DECLARATION.description,
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query, phrased with regulatory terminology.' },
      domain: { type: 'string', description: 'Optional domain/regulator filter, e.g. "RBI", "SEBI". Omit to search all domains.' },
    },
    required: ['query'],
  },
};

interface AgentFinalJson {
  reasoning?: string;
  answer?: string;
  obligations?: Obligation[];
  conflicts?: Conflict[];
  confidence?: 'high' | 'medium' | 'low';
  confidence_reason?: string;
  sources_used?: number[];
}

/** Extracts the final structured JSON the model returns once it's done calling tools. */
function parseFinalJson(raw: string): AgentFinalJson {
  const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Model didn't return clean JSON (rare, but free-tier models occasionally
    // wrap it in prose). Fall back to treating the whole thing as the answer
    // text so the turn doesn't hard-fail — confidence stays conservative.
    return { answer: trimmed };
  }
}

/** Runs a single retrieve_chunks tool call and records it for the transparency trail. */
async function callRetrieveChunks(
  args: { query?: string; domain?: string },
  fallbackQuery: string,
  toolsUsed: ToolCallRecord[],
  allChunks: RetrievedChunk[]
): Promise<{ chunks: RetrievedChunk[]; error?: string }> {
  const query = args.query || fallbackQuery;
  const domain = args.domain;
  try {
    const chunks = await retrieveChunks(query, TOP_K_PER_CALL, domain);
    allChunks.push(...chunks);
    toolsUsed.push({
      tool: 'retrieve_chunks',
      input: { query, domain },
      output_summary:
        chunks.length > 0
          ? `${chunks.length} chunk(s) from: ${[...new Set(chunks.map((c) => c.metadata.title))].join(', ')}`
          : 'no matching chunks found',
    });
    return { chunks };
  } catch (err: any) {
    const message = err?.message || 'retrieval failed';
    toolsUsed.push({
      tool: 'retrieve_chunks',
      input: { query, domain },
      output_summary: `error: ${message}`,
    });
    return { chunks: [], error: message };
  }
}

/** Builds a stable [Source N] numbering across every chunk retrieved so far this turn, in call order. */
function numberedSourcesBlock(allChunks: RetrievedChunk[]): string {
  return allChunks
    .map((c, i) => {
      const meta = c.metadata;
      const ref = meta.clause_ref ? ` (${meta.clause_ref})` : '';
      return `[Source ${i + 1}] Document: "${meta.title}" | Domain: ${meta.domain}${ref}\n${meta.text}`;
    })
    .join('\n\n---\n\n');
}

function finalizeAnswer(
  finalJson: AgentFinalJson,
  allChunks: RetrievedChunk[],
  toolsUsed: ToolCallRecord[]
): AgentAnswer {
  const rawAnswer = finalJson.answer || 'The agent did not produce a final answer.';
  const sourcesUsed = Array.isArray(finalJson.sources_used) ? finalJson.sources_used : [];
  const { answer, citations } = resolveCitations(rawAnswer, sourcesUsed, allChunks);

  // Same safety net as the single-shot RAG path: a refusal/no-context answer
  // must never surface as high/medium confidence, even if the model's JSON
  // said otherwise.
  let confidence = finalJson.confidence === 'high' || finalJson.confidence === 'medium' || finalJson.confidence === 'low'
    ? finalJson.confidence
    : 'medium';
  if (allChunks.length === 0 || citations.length === 0) {
    confidence = 'low';
  }

  return {
    reasoning: finalJson.reasoning || '',
    tools_used: toolsUsed,
    answer,
    citations,
    obligations: Array.isArray(finalJson.obligations) ? finalJson.obligations : [],
    conflicts: [], // always [] until Milestone 2 (compare_obligations) is wired in
    confidence,
    confidence_reason: finalJson.confidence_reason || '',
    retrieved_chunks: allChunks,
  };
}

async function runGeminiAgentTurn(question: string, domain?: string): Promise<AgentAnswer> {
  const model = genAI.getGenerativeModel({
    model: GEMINI_CHAT_MODEL,
    systemInstruction: AGENT_SYSTEM_PROMPT,
    tools: [{ functionDeclarations: [RETRIEVE_CHUNKS_DECLARATION] }],
  });
  const chat = model.startChat();

  const toolsUsed: ToolCallRecord[] = [];
  const allChunks: RetrievedChunk[] = [];
  let toolCallCount = 0;

  const opener = domain && domain !== 'all'
    ? `Compliance question: ${question}\n(User requested domain filter: ${domain})`
    : `Compliance question: ${question}`;

  let result = await chat.sendMessage(opener);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const calls: FunctionCall[] | undefined = result.response.functionCalls();
    if (!calls || calls.length === 0) break;

    if (toolCallCount >= MAX_TOOL_CALLS) {
      result = await chat.sendMessage(
        'You have used your maximum tool-call budget for this turn. Give your final answer now, using only the sources retrieved so far, in the required JSON format.'
      );
      continue;
    }

    const responseParts: Content['parts'] = [];
    for (const call of calls) {
      if (toolCallCount >= MAX_TOOL_CALLS) {
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: { error: 'Tool-call budget exhausted for this turn.' },
          },
        });
        continue;
      }
      toolCallCount++;

      if (call.name === 'retrieve_chunks') {
        const args = (call.args || {}) as { query?: string; domain?: string };
        const { chunks, error } = await callRetrieveChunks(args, question, toolsUsed, allChunks);
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: error
              ? { error }
              : { sources: numberedSourcesBlock(allChunks), new_chunks_count: chunks.length },
          },
        });
      } else {
        // Guard only — shouldn't happen since it's the only declared tool.
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: { error: `${call.name} is not available yet.` },
          },
        });
      }
    }

    result = await chat.sendMessage(responseParts);
  }

  const finalJson = parseFinalJson(result.response.text());
  return finalizeAnswer(finalJson, allChunks, toolsUsed);
}

async function callClaudeMessages(body: Record<string, unknown>): Promise<any> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Claude API error: ${data?.error?.message || res.statusText}`);
  }
  return data;
}

async function runClaudeAgentTurn(question: string, domain?: string): Promise<AgentAnswer> {
  const toolsUsed: ToolCallRecord[] = [];
  const allChunks: RetrievedChunk[] = [];
  let toolCallCount = 0;

  const opener = domain && domain !== 'all'
    ? `Compliance question: ${question}\n(User requested domain filter: ${domain})`
    : `Compliance question: ${question}`;

  const messages: any[] = [{ role: 'user', content: opener }];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data = await callClaudeMessages({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: AGENT_SYSTEM_PROMPT,
      tools: [CLAUDE_RETRIEVE_CHUNKS_TOOL],
      messages,
    });

    messages.push({ role: 'assistant', content: data.content });

    if (data.stop_reason !== 'tool_use') {
      const textBlock = (data.content || []).find((b: any) => b.type === 'text');
      const finalJson = parseFinalJson(textBlock?.text || '');
      return finalizeAnswer(finalJson, allChunks, toolsUsed);
    }

    const toolResults: any[] = [];
    for (const block of data.content) {
      if (block.type !== 'tool_use') continue;

      if (toolCallCount >= MAX_TOOL_CALLS) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ error: 'Tool-call budget exhausted for this turn.' }),
        });
        continue;
      }
      toolCallCount++;

      if (block.name === 'retrieve_chunks') {
        const { chunks, error } = await callRetrieveChunks(block.input || {}, question, toolsUsed, allChunks);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(
            error
              ? { error }
              : { sources: numberedSourcesBlock(allChunks), new_chunks_count: chunks.length }
          ),
        });
      } else {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ error: `${block.name} is not available yet.` }),
        });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }
}

/**
 * Phase 3 Milestone 1 entry point: runs one agentic turn (plan -> call
 * retrieve_chunks up to MAX_TOOL_CALLS times -> structured JSON answer).
 * Dispatches to whichever provider lib/llm.ts is configured to use.
 */
export async function runAgentTurn(question: string, domain?: string): Promise<AgentAnswer> {
  if (LLM_PROVIDER === 'claude' && ANTHROPIC_API_KEY) {
    return runClaudeAgentTurn(question, domain);
  }
  return runGeminiAgentTurn(question, domain);
}
