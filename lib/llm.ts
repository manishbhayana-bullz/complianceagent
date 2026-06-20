import { GoogleGenerativeAI } from '@google/generative-ai';
import type { RetrievedChunk, QueryAnswer, Citation } from './types';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';
// text-embedding-004 was shut down Jan 14 2026 — gemini-embedding-001 is the
// current free-tier replacement. It defaults to 3072 dims but supports
// scaling down via outputDimensionality (we use 768 to match Pinecone).
const GEMINI_EMBED_MODEL =
  process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
const EMBED_DIMENSION = parseInt(process.env.PINECONE_DIMENSION || '768', 10);

const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

if (!GEMINI_API_KEY) {
  console.warn(
    '[lib/llm] GEMINI_API_KEY is not set. Embeddings and (by default) generation will fail.'
  );
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

/**
 * Embeddings go through Gemini's free gemini-embedding-001 model via direct
 * REST call (the JS SDK's embedContent signature doesn't reliably expose
 * outputDimensionality), scaled to match the Pinecone index dimension.
 */
export async function embedText(text: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      outputDimensionality: EMBED_DIMENSION,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Gemini embedding error: ${data?.error?.message || res.statusText}`
    );
  }
  return data.embedding.values as number[];
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  // text-embedding-004 has no batch endpoint in the JS SDK yet — run sequentially
  // to stay comfortably under free-tier rate limits.
  const embeddings: number[][] = [];
  for (const text of texts) {
    embeddings.push(await embedText(text));
    // small delay to respect free-tier RPM limits
    await new Promise((r) => setTimeout(r, 150));
  }
  return embeddings;
}

const SYSTEM_PROMPT = `You are ComplianceAgent, a multi-domain regulatory compliance assistant.
Answer the user's compliance question using ONLY the provided context chunks from regulatory circulars/policies.
Rules:
- If the context does not contain enough information to answer, say so explicitly. Do not guess or invent regulatory requirements.
- Every factual claim must be traceable to a specific context chunk. Reference chunks by their [Source N] label.
- Be precise about obligations, deadlines, thresholds, and exceptions — these are compliance-critical.
- Keep the tone formal and audit-appropriate.
- After your answer, on a new line, output a JSON object exactly in this form:
{"confidence": "high|medium|low", "sources_used": [list of integers referring to [Source N] labels actually used]}
`;

function buildContextBlock(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => {
      const meta = c.metadata;
      const ref = meta.clause_ref ? ` (${meta.clause_ref})` : '';
      return `[Source ${i + 1}] Document: "${meta.title}" | Domain: ${meta.domain}${ref}\n${meta.text}`;
    })
    .join('\n\n---\n\n');
}

/** Generate a RAG answer with citations, using whichever provider is configured. */
export async function generateAnswer(
  question: string,
  chunks: RetrievedChunk[]
): Promise<QueryAnswer> {
  const contextBlock = buildContextBlock(chunks);
  const userPrompt = `Context:\n\n${contextBlock}\n\nQuestion: ${question}`;

  let rawOutput: string;
  if (LLM_PROVIDER === 'claude' && ANTHROPIC_API_KEY) {
    rawOutput = await generateWithClaude(userPrompt);
  } else {
    rawOutput = await generateWithGemini(userPrompt);
  }

  return parseAnswerOutput(rawOutput, chunks);
}

async function generateWithGemini(userPrompt: string): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: GEMINI_CHAT_MODEL,
    systemInstruction: SYSTEM_PROMPT,
  });
  const result = await model.generateContent(userPrompt);
  return result.response.text();
}

async function generateWithClaude(userPrompt: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      `Claude API error: ${data?.error?.message || response.statusText}`
    );
  }
  return data.content.map((b: any) => b.text || '').join('\n');
}

/** Splits the model output into the prose answer + structured metadata, and maps [Source N] to citations. */
function parseAnswerOutput(
  rawOutput: string,
  chunks: RetrievedChunk[]
): QueryAnswer {
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  let sourcesUsed: number[] = [];

  // Try to find a trailing JSON object with confidence + sources_used
  const jsonMatch = rawOutput.match(/\{[^{}]*"confidence"[^{}]*\}/);
  let answer = rawOutput;

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (['high', 'medium', 'low'].includes(parsed.confidence)) {
        confidence = parsed.confidence;
      }
      if (Array.isArray(parsed.sources_used)) {
        sourcesUsed = parsed.sources_used.filter(
          (n: unknown) => typeof n === 'number'
        );
      }
    } catch {
      // ignore malformed JSON, fall back to defaults
    }
    answer = rawOutput.slice(0, jsonMatch.index).trim();
  }

  // Fallback: if model didn't report sources, cite every retrieved chunk
  // referenced by [Source N] in the text, or all of them if none found.
  if (sourcesUsed.length === 0) {
    const refs = [...answer.matchAll(/\[Source (\d+)\]/g)].map((m) =>
      parseInt(m[1], 10)
    );
    sourcesUsed = refs.length > 0 ? [...new Set(refs)] : chunks.map((_, i) => i + 1);
  }

  // Dedupe sourcesUsed by underlying chunk text (handles circulars ingested
  // more than once, which otherwise surface as separate-but-identical
  // sources) and build an old-number -> new-number map so we can rewrite
  // [Source N] labels in the answer text to match the deduped list. Doing
  // this keeps the visible answer and citations list consistent — without
  // it, a downstream consumer (e.g. the audit report) can see "[Source 2]"
  // referenced in text that no longer has a 2nd citation, which reads as
  // an unverifiable claim and wrongly depresses confidence.
  const seenExcerpts = new Map<string, number>(); // excerpt -> new source number
  const oldToNewSourceNumber = new Map<number, number>();
  const citations: Citation[] = [];

  for (const n of sourcesUsed) {
    const chunk = chunks[n - 1];
    if (!chunk) continue;
    const excerptKey = chunk.metadata.text.trim().toLowerCase();

    if (seenExcerpts.has(excerptKey)) {
      oldToNewSourceNumber.set(n, seenExcerpts.get(excerptKey)!);
      continue;
    }

    const newNumber = citations.length + 1;
    seenExcerpts.set(excerptKey, newNumber);
    oldToNewSourceNumber.set(n, newNumber);
    citations.push({
      doc_id: chunk.metadata.doc_id,
      title: chunk.metadata.title,
      clause_ref: chunk.metadata.clause_ref,
      chunk_index: chunk.metadata.chunk_index,
      excerpt: chunk.metadata.text.slice(0, 280),
    });
  }

  // Rewrite [Source N] / [Source N, Source M, ...] labels in the answer to
  // the renumbered, deduped set. The model sometimes cites multiple sources
  // in one bracket (e.g. "[Source 2, Source 3]"), so we match the whole
  // bracket rather than a single number, renumber + dedupe each reference
  // inside it, and reassemble.
  answer = answer.replace(/\[Source [\d,\s]*\d[\s\d,]*\]/g, (bracket) => {
    const nums = [...bracket.matchAll(/\d+/g)].map((m) => parseInt(m[0], 10));
    const newNums = [
      ...new Set(
        nums
          .map((n) => oldToNewSourceNumber.get(n))
          .filter((n): n is number => typeof n === 'number')
      ),
    ];
    if (newNums.length === 0) return bracket; // leave unrecognized refs untouched
    return `[${newNums.map((n) => `Source ${n}`).join(', ')}]`;
  });

  return { answer, citations, confidence, retrieved_chunks: chunks };
}

/** Generates a formal audit-style writeup of a Q&A exchange for the audit report endpoint. */
export async function generateAuditNarrative(
  question: string,
  answer: string,
  citations: Citation[]
): Promise<string> {
  const citationList = citations
    .map(
      (c, i) =>
        `${i + 1}. ${c.title}${c.clause_ref ? ` — ${c.clause_ref}` : ''} (chunk #${c.chunk_index})`
    )
    .join('\n');

  const prompt = `Write a short, formal audit-trail summary (3-5 sentences) suitable for inclusion in a compliance audit report.
It should describe: what was asked, the regulatory basis for the answer, and which source documents were relied upon. Do not invent new facts.

Question: ${question}

Answer given to the user:
${answer}

Sources relied upon:
${citationList}`;

  if (LLM_PROVIDER === 'claude' && ANTHROPIC_API_KEY) {
    return generateWithClaude(prompt);
  }
  return generateWithGemini(prompt);
}
