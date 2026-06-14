'use client';

import { useState } from 'react';

interface IngestResult {
  doc_id: string;
  title: string;
  domain: string;
  chunks_indexed: number;
}

export default function UploadPanel({
  onIngested,
}: {
  onIngested: (result: IngestResult) => void;
}) {
  const [mode, setMode] = useState<'pdf' | 'text'>('pdf');
  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState('General');
  const [pastedText, setPastedText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const reset = () => {
    setTitle('');
    setPastedText('');
    setFile(null);
  };

  const handleSubmit = async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      let res: Response;
      if (mode === 'pdf') {
        if (!file) throw new Error('Choose a PDF file first.');
        const form = new FormData();
        form.append('file', file);
        form.append('title', title || file.name);
        form.append('domain', domain);
        res = await fetch('/api/ingest', { method: 'POST', body: form });
      } else {
        if (!pastedText.trim()) throw new Error('Paste some circular text first.');
        res = await fetch('/api/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: pastedText, title, domain }),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ingestion failed');

      onIngested(data);
      reset();
      setStatus('idle');
    } catch (err: any) {
      setErrorMsg(err.message || 'Something went wrong');
      setStatus('error');
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Step 1 — Ingest a circular
      </h2>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => setMode('pdf')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            mode === 'pdf'
              ? 'bg-accent text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Upload PDF
        </button>
        <button
          onClick={() => setMode('text')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            mode === 'text'
              ? 'bg-accent text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Paste text
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-slate-500">
            Title (optional)
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. RBI Master Direction on KYC"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">
            Domain
          </label>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="e.g. RBI, SEBI, GDPR, Internal Policy"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {mode === 'pdf' ? (
        <div className="mt-4">
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
          />
        </div>
      ) : (
        <textarea
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          rows={8}
          placeholder="Paste the full text of the circular here..."
          className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      )}

      {errorMsg && (
        <p className="mt-3 text-sm text-red-600">{errorMsg}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={status === 'loading'}
        className="mt-4 rounded-md bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
      >
        {status === 'loading' ? 'Ingesting…' : 'Ingest document'}
      </button>
    </section>
  );
}
