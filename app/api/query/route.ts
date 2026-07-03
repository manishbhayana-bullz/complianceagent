import { NextRequest, NextResponse } from 'next/server';
import { embedText, generateAnswer } from '@/lib/llm';
import { queryChunks } from '@/lib/pinecone';
import { insertQueryLog } from '@/lib/supabase';
import { embedText, generateAnswer, rewriteQuery } from '@/lib/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const question: string = body.question;
    const domain: string | undefined = body.domain; // optional filter
    const topK: number = body.topK || 5;

    if (!question || question.trim().length === 0) {
      return NextResponse.json({ error: 'No question provided' }, { status: 400 });
    }
    
    let searchQuery = question;
    try {
      searchQuery = await rewriteQuery(question);
    } catch (err) {
      console.warn('[api/query] query rewrite failed, using original question', err);
    }
    
    const queryVector = await embedText(searchQuery);
    const filter = domain && domain !== 'all' ? { domain: { $eq: domain } } : undefined;
    const rawChunks = await queryChunks(queryVector, topK, filter);

    // If the same circular was ingested more than once (common during
    // testing/iteration), retrieval can return several chunks with
    // identical text. Collapse those before they reach the model so the
    // answer doesn't double-cite the same passage.
    const seenText = new Set<string>();
    const retrievedChunks = rawChunks.filter((c) => {
      const key = c.metadata.text.trim().toLowerCase();
      if (seenText.has(key)) return false;
      seenText.add(key);
      return true;
    });

    if (retrievedChunks.length === 0) {
      return NextResponse.json({
        answer:
          'No relevant content was found in the indexed circulars for this question. Try uploading the relevant circular first, or rephrase your question.',
        citations: [],
        confidence: 'low',
        retrieved_chunks: [],
      });
    }

    const result = await generateAnswer(question, retrievedChunks);

    // Log for audit trail (non-blocking on failure)
    let queryLogId: string | undefined;
    try {
      queryLogId = await insertQueryLog({
        question,
        answer: result.answer,
        confidence: result.confidence,
        citations: result.citations,
      });
    } catch (logErr) {
      console.warn('[api/query] failed to log query', logErr);
    }

    return NextResponse.json({ ...result, query_log_id: queryLogId });
  } catch (err: any) {
    console.error('[api/query] error', err);
    return NextResponse.json(
      { error: err?.message || 'Query failed' },
      { status: 500 }
    );
  }
}
