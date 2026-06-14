import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const checks = {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    pinecone: Boolean(process.env.PINECONE_API_KEY),
    supabase:
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    provider: process.env.LLM_PROVIDER || 'gemini',
  };

  const ok = checks.gemini && checks.pinecone && checks.supabase;

  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 500 });
}
