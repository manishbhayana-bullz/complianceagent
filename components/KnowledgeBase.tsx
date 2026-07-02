'use client';

import { useEffect, useState, useCallback } from 'react';

interface DocumentRecord {
  id: string;
  title: string;
  domain: string;
  source_type: 'pdf' | 'text';
  uploaded_at: string;
  chunk_count: number;
}

export default function KnowledgeBase({ refreshKey }: { refreshKey?: number }) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load documents');
      setDocuments(data.documents);
      setStatus('idle');
    } catch (err: any) {
      setErrorMsg(err.message || 'Something went wrong');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments, refreshKey]);

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"? This removes it from the knowledge base permanently.`)) {
      return;
    }
    setDeletingId(id);
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete document');
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to delete document');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Knowledge base
        </h2>
        <button
          onClick={fetchDocuments}
          className="text-xs font-medium text-accent hover:underline"
        >
          Refresh
        </button>
      </div>

      {status === 'loading' && (
        <p className="mt-4 text-sm text-slate-400">Loading documents…</p>
      )}

      {status === 'error' && (
        <p className="mt-4 text-sm text-red-600">{errorMsg}</p>
      )}

      {status === 'idle' && documents.length === 0 && (
        <p className="mt-4 text-sm text-slate-400">
          No documents ingested yet. Upload a circular above to get started.
        </p>
      )}

      {status === 'idle' && documents.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {doc.title}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {doc.domain} · {doc.source_type.toUpperCase()} ·{' '}
                  {doc.chunk_count} chunk{doc.chunk_count === 1 ? '' : 's'} ·{' '}
                  {new Date(doc.uploaded_at).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => handleDelete(doc.id, doc.title)}
                disabled={deletingId === doc.id}
                className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                {deletingId === doc.id ? 'Deleting…' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
