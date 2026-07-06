import { queryChunks } from './pinecone';
import { embedText, rewriteQuery } from './llm';
import type { RetrievedChunk } from './types';

/**
 * Shared retrieval path: rewrite the question for retrieval, embed it,
 * query Pinecone, then collapse duplicate chunks (same underlying text
 * ingested more than once). Used by:
 *  - app/api/query/route.ts (single-shot RAG)
 *  - lib/agent.ts's retrieve_chunks tool (Phase 3 orchestrator)
 *
 * Keeping this in one place means both paths retrieve identically, so
 * behavior doesn't silently diverge between "ask" and "agent" modes.
 */
export async function retrieveChunks(
  question: string,
  topK = 5,
  domain?: string
): Promise<RetrievedChunk[]> {
  let searchQuery = question;
  try {
    searchQuery = await rewriteQuery(question);
  } catch (err) {
    console.warn(
      '[lib/retrieval] query rewrite failed, using original question',
      err
    );
  }

  const queryVector = await embedText(searchQuery);
  const filter =
    domain && domain !== 'all' ? { domain: { $eq: domain } } : undefined;
  const rawChunks = await queryChunks(queryVector, topK, filter);

  const seenText = new Set<string>();
  return rawChunks.filter((c) => {
    const key = c.metadata.text.trim().toLowerCase();
    if (seenText.has(key)) return false;
    seenText.add(key);
    return true;
  });
}
