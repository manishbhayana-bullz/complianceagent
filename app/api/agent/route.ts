import { NextRequest, NextResponse } from 'next/server';
import { runAgentTurn } from '@/lib/agent';
import { insertQueryLog, insertUsageLog } from '@/lib/supabase';
import { getAuthedUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const question: string = body.question;
    const domain: string | undefined = body.domain;

    if (!question || question.trim().length === 0) {
      return NextResponse.json({ error: 'No question provided' }, { status: 400 });
    }

    const result = await runAgentTurn(question, domain);

    let queryLogId: string | undefined;
    try {
      queryLogId = await insertQueryLog({
        question,
        answer: result.answer,
        confidence: result.confidence,
        citations: result.citations,
        userId: user.id,
      });
    } catch (logErr) {
      console.warn('[api/agent] failed to log query', logErr);
    }
   await insertUsageLog({ userId: user.id, actionType: 'agent' })
     .catch((err) => console.warn('[api/agent] usage log failed', err));
    
    return NextResponse.json({ ...result, query_log_id: queryLogId });
  } catch (err: any) {
    console.error('[api/agent] error', err);
    return NextResponse.json(
      { error: err?.message || 'Agent turn failed' },
      { status: 500 }
    );
  }
}
