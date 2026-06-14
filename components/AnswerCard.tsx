'use client';

import { useState } from 'react';
import type { Citation } from '@/lib/types';
import { confidenceStyles } from './QueryPanel';

export interface AnswerCardProps {
  question: string;
  answer: string;
  citations: Citation[];
  confidence: 'high' | 'medium' | 'low';
  queryLogId?: string;
}

export default function AnswerCard({
  question,
  answer,
  citations,
  confidence,
  queryLogId,
}: AnswerCardProps) {
  const [reportStatus, setReportStatus] = useState<'idle' | 'loading'>('idle');
  const [report, setReport] = useState<string | null>(null);

  const handleGenerateReport = async () => {
    setReportStatus('loading');
    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          answer,
          citations,
          query_log_id: queryLogId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Audit report failed');

      const text = formatReportAsText(data);
      setReport(text);
    } catch (err: any) {
      setReport(`Error generating report: ${err.message}`);
    } finally {
      setReportStatus('idle');
    }
  };

  const handleDownload = () => {
    if (!report) return;
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliance-audit-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Question
          </p>
          <p className="mt-1 text-sm font-medium text-slate-800">{question}</p>
        </div>
        <span
          className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${confidenceStyles[confidence]}`}
        >
          {confidence.toUpperCase()} confidence
        </span>
      </div>

      <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
        {answer}
      </div>

      {citations.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Citations
          </p>
          <ul className="mt-2 space-y-2">
            {citations.map((c, i) => (
              <li
                key={i}
                className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
              >
                <p className="font-semibold text-slate-700">
                  {c.title}
                  {c.clause_ref ? ` — ${c.clause_ref}` : ''}{' '}
                  <span className="font-normal text-slate-400">
                    (chunk #{c.chunk_index})
                  </span>
                </p>
                <p className="mt-1 italic text-slate-500">“{c.excerpt}…”</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={handleGenerateReport}
          disabled={reportStatus === 'loading'}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {reportStatus === 'loading' ? 'Generating report…' : 'Generate audit report'}
        </button>
        {report && (
          <button
            onClick={handleDownload}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Download .txt
          </button>
        )}
      </div>

      {report && (
        <pre className="mt-4 max-h-72 overflow-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">
          {report}
        </pre>
      )}
    </section>
  );
}

function formatReportAsText(data: any): string {
  const lines: string[] = [];
  lines.push('COMPLIANCEAGENT — AUDIT REPORT');
  lines.push('='.repeat(40));
  lines.push(`Generated: ${data.generated_at}`);
  lines.push('');
  lines.push('QUESTION');
  lines.push(data.question);
  lines.push('');
  lines.push('ANSWER');
  lines.push(data.answer);
  lines.push('');
  lines.push('AUDIT NARRATIVE');
  lines.push(data.narrative);
  lines.push('');
  lines.push('SOURCES RELIED UPON');
  (data.citations || []).forEach((c: Citation, i: number) => {
    lines.push(
      `${i + 1}. ${c.title}${c.clause_ref ? ` — ${c.clause_ref}` : ''} (chunk #${c.chunk_index})`
    );
    lines.push(`   "${c.excerpt}..."`);
  });
  lines.push('');
  lines.push('DOMAINS COVERED: ' + (data.domains_covered || []).join(', '));
  lines.push('');
  lines.push('DISCLAIMER');
  lines.push(data.disclaimer);
  return lines.join('\n');
}
