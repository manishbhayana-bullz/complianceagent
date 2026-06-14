'use client';

import { useState } from 'react';
import type { Citation } from '@/lib/types';

export interface QueryResult {
  answer: string;
  citations: Citation[];
  confidence: 'high' | 'medium' | 'low';
  query_log_id?: string;
}

const confidenceStyles: Record<string, string> = {
  high: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-red-100 text-red-700',
};

export default function QueryPanel({
  onResult,
}: {
  onResult: (question: string, result: QueryResult) => void;
}) {
  const [question, setQuestion] = useState('');
  const [domain, setDomain] = useState('all');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAsk = async () => {
    if (!question.trim()) return;
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Query failed');

      onResult(question, data as QueryResult);
      setStatus('idle');
    } catch (err: any) {
      setErrorMsg(err.message || 'Something went wrong');
      setStatus('error');
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Step 2 — Ask a compliance question
      </h2>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
          placeholder="e.g. What are the KYC re-verification timelines for low-risk customers?"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <input
          value={domain === 'all' ? '' : domain}
          onChange={(e) => setDomain(e.target.value || 'all')}
          placeholder="Domain filter (optional)"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent sm:w-56"
        />
        <button
          onClick={handleAsk}
          disabled={status === 'loading'}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Retrieving…' : 'Ask'}
        </button>
      </div>

      {errorMsg && <p className="mt-3 text-sm text-red-600">{errorMsg}</p>}
    </section>
  );
}

export { confidenceStyles };
