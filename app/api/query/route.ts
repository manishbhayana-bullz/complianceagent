import { NextRequest, NextResponse } from 'next/server';
import { insertQueryLog } from '@/lib/supabase';
import { generateAnswer } from '@/lib/llm';
import { retrieveChunks } from '@/lib/retrieval';

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

    const retrievedChunks = await retrieveChunks(question, topK, domain);

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
