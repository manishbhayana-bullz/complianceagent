import { Pinecone } from '@pinecone-database/pinecone';
import type { ChunkMetadata, RetrievedChunk } from './types';

const PINECONE_API_KEY = process.env.PINECONE_API_KEY || '';
const PINECONE_INDEX = process.env.PINECONE_INDEX || 'complianceagent';
const PINECONE_DIMENSION = parseInt(
  process.env.PINECONE_DIMENSION || '768',
  10
);

if (!PINECONE_API_KEY) {
  console.warn('[lib/pinecone] PINECONE_API_KEY is not set.');
}

const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });

/** Ensures the index exists (serverless, free-tier compatible). Safe to call on every cold start. */
export async function ensureIndex(): Promise<void> {
  const existing = await pinecone.listIndexes();
  const exists = existing.indexes?.some((i) => i.name === PINECONE_INDEX);
  if (!exists) {
    await pinecone.createIndex({
      name: PINECONE_INDEX,
      dimension: PINECONE_DIMENSION,
      metric: 'cosine',
      spec: {
        serverless: {
          cloud: 'aws',
          region: 'us-east-1',
        },
      },
    });
    // Newly created serverless indexes take a few seconds to become ready
    await new Promise((r) => setTimeout(r, 5000));
  }
}

export function getIndex() {
  return pinecone.index(PINECONE_INDEX);
}

export interface UpsertChunk {
  id: string;
  values: number[];
  metadata: ChunkMetadata;
}

export async function upsertChunks(chunks: UpsertChunk[]): Promise<void> {
  const index = getIndex();
  // Pinecone recommends batches of <= 100 vectors
  const BATCH_SIZE = 100;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    await index.upsert(
      batch.map((c) => ({
        id: c.id,
        values: c.values,
        metadata: c.metadata as unknown as Record<string, any>,
      }))
    );
  }
}

export async function queryChunks(
  vector: number[],
  topK = 5,
  filter?: Record<string, any>
): Promise<RetrievedChunk[]> {
  const index = getIndex();
  const result = await index.query({
    vector,
    topK,
    includeMetadata: true,
    ...(filter ? { filter } : {}),
  });

  return (result.matches || []).map((m) => ({
    id: m.id,
    score: m.score ?? 0,
    metadata: m.metadata as unknown as ChunkMetadata,
  }));
}

/**
 * Deletes all vectors belonging to a document.
 *
 * We reconstruct the exact vector IDs from doc_id + chunk_count rather than
 * using a metadata filter delete, since ingest always writes vectors with
 * deterministic IDs of the form `${docId}::${chunkIndex}` (see
 * app/api/ingest/route.ts). This is more portable than filter-based delete,
 * which has inconsistent support across Pinecone tiers/index types.
 */
export async function deleteChunksByDocId(
  docId: string,
  chunkCount: number
): Promise<void> {
  const index = getIndex();
  const ids = Array.from({ length: chunkCount }, (_, i) => `${docId}::${i}`);

  // Match the upsert batching convention (<= 100 ids per call).
  const BATCH_SIZE = 100;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    await index.deleteMany(batch);
  }
}
