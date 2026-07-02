import { NextRequest, NextResponse } from 'next/server';
import { getDocument, deleteDocument } from '@/lib/supabase';
import { deleteChunksByDocId } from '@/lib/pinecone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const doc = await getDocument(params.id);
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    await deleteChunksByDocId(doc.id, doc.chunk_count);
    await deleteDocument(doc.id);

    return NextResponse.json({ deleted: doc.id });
  } catch (err: any) {
    console.error('[api/documents/:id DELETE] error', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to delete document' },
      { status: 500 }
    );
  }
}
