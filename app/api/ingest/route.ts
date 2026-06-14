import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { extractTextFromPdf } from '@/lib/pdf';
import { chunkText, detectClauseRef } from '@/lib/chunking';
import { embedTexts } from '@/lib/llm';
import { ensureIndex, upsertChunks } from '@/lib/pinecone';
import { insertDocument } from '@/lib/supabase';
import type { ChunkMetadata } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
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

    const chunks = chunkText(rawText);
    if (chunks.length === 0) {
      return NextResponse.json(
        { error: 'Document produced no usable chunks' },
        { status: 422 }
      );
    }

    const docId = uuidv4();
    const embeddings = await embedTexts(chunks);

    await ensureIndex();

    const upserts = chunks.map((chunkContent, i) => {
      const metadata: ChunkMetadata = {
        doc_id: docId,
        title,
        domain,
        chunk_index: i,
        text: chunkContent,
        clause_ref: detectClauseRef(chunkContent),
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
    });

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
