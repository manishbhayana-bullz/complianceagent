import { NextResponse } from 'next/server';
import { listDocuments } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const documents = await listDocuments();
    return NextResponse.json({ documents });
  } catch (err: any) {
    console.error('[api/documents] error', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to list documents' },
      { status: 500 }
    );
  }
}
