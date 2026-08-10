import { NextResponse } from 'next/server';
import { listDocuments } from '@/lib/supabase';
import { getAuthedUser } from '@/lib/auth';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  } 
  try {
    const documents = await listDocuments(user.id);
    return NextResponse.json({ documents });
  } catch (err: any) {
    console.error('[api/documents] error', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to list documents' },
      { status: 500 }
    );
  }
}
