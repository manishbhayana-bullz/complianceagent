import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { extractTextFromPdf } from '@/lib/pdf';
import { chunkText } from '@/lib/chunking';
import { embedTexts } from '@/lib/llm';
import { ensureIndex, upsertChunks } from '@/lib/pinecone';
import { insertDocument, insertUsageLog } from '@/lib/supabase';
import { getAuthedUser } from '@/lib/auth';
import type { ChunkMetadata } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getAuthedUser();
  if (!user) {
     return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
 }
  try {
    const contentType = req.headers.get('content-type') || '';
    let title: string;
    let domain: string;
    let sourceType: 'pdf' | 'text';
    let rawText: string;

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file') as File | null;
      title = (form.get('title') as string) || file?.name || 'Untitled circular';
      domain = (form.get('domain') as string) || 'General';

      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      rawText = await extractTextFromPdf(buffer);
      sourceType = 'pdf';
    } else {
      const body = await req.json();
      if (!body.text) {
        return NextResponse.json({ error: 'No text provided' }, { status: 400 });
      }
      title = body.title || 'Pasted circular';
      domain = body.domain || 'General';
      rawText = body.text;
      sourceType = 'text';
    }

    if (!rawText || rawText.trim().length === 0) {
      return NextResponse.json(
        { error: 'No extractable text found in the document' },
        { status: 422 }
      );
    }

    // chunkText now returns Chunk[] ({ text, clauseRef }) instead of a plain
    // string[] — clause_ref is computed during chunking, where we still have
    // document-order context (which clause heading came before this text),
    // rather than re-derived after the fact from an isolated chunk's own
    // text (which is ambiguous or altogether missing the label).
    const chunks = chunkText(rawText);
    if (chunks.length === 0) {
      return NextResponse.json(
        { error: 'Document produced no usable chunks' },
        { status: 422 }
      );
    }

    const docId = uuidv4();
    const embeddings = await embedTexts(chunks.map((c) => c.text));

    await ensureIndex();

    const upserts = chunks.map((chunk, i) => {
      const metadata: ChunkMetadata = {
        doc_id: docId,
        title,
        domain,
        chunk_index: i,
        text: chunk.text,
        clause_ref: chunk.clauseRef,
      };
      return {
        id: `${docId}::${i}`,
        values: embeddings[i],
        metadata,
      };
    });

    await upsertChunks(upserts);

    await insertDocument({
      id: docId,
      title,
      domain,
      source_type: sourceType,
      uploaded_at: new Date().toISOString(),
      chunk_count: chunks.length,
      user_id: user.id,
    });
    await insertUsageLog({
         userId: user.id,
         actionType: 'ingest',
         documentId: docId,
       }).catch((err) => console.warn('[api/ingest] usage log failed', err));

    return NextResponse.json({
      doc_id: docId,
      title,
      domain,
      chunks_indexed: chunks.length,
    });
  } catch (err: any) {
    console.error('[api/ingest] error', err);
    return NextResponse.json(
      { error: err?.message || 'Ingestion failed' },
      { status: 500 }
    );
  }
}
