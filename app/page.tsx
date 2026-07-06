'use client';

import { useState } from 'react';
import UploadPanel from '@/components/UploadPanel';
import QueryPanel, { QueryResult } from '@/components/QueryPanel';
import AnswerCard from '@/components/AnswerCard';
import KnowledgeBase from '@/components/KnowledgeBase';

interface IngestedDoc {
  doc_id: string;
  title: string;
  domain: string;
  chunks_indexed: number;
}

interface Exchange {
  question: string;
  result: QueryResult;
  agentMode: boolean;
}

export default function HomePage() {
  const [ingested, setIngested] = useState<IngestedDoc[]>([]);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">
          ComplianceAgent · Phase 1 MVP
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Multi-domain compliance Q&amp;A with cited answers
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Ingest a circular, ask a question, get an answer grounded in the
          source text with traceable citations and an exportable audit
          report.
        </p>
      </header>

      <div className="space-y-6">
         <UploadPanel
          onIngested={(doc) => {
            setIngested((prev) => [doc, ...prev]);
            setRefreshKey((k) => k + 1);
          }}
        />
        
        {ingested.length > 0 && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="font-semibold">Indexed documents</p>
            <ul className="mt-1 space-y-1">
              {ingested.map((doc) => (
                <li key={doc.doc_id}>
                  {doc.title} — {doc.domain} ({doc.chunks_indexed} chunks)
                </li>
              ))}
            </ul>
          </div>
        )}
      <KnowledgeBase refreshKey={refreshKey} />
        <QueryPanel
          onResult={(question, result, agentMode) =>
            setExchanges((prev) => [{ question, result, agentMode }, ...prev])
          }
        />

        {exchanges.map((ex, i) => (
          <AnswerCard
            key={i}
            question={ex.question}
            answer={ex.result.answer}
            citations={ex.result.citations}
            confidence={ex.result.confidence}
            queryLogId={ex.result.query_log_id}
            reasoning={ex.agentMode ? ex.result.reasoning : undefined}
            toolsUsed={ex.agentMode ? ex.result.tools_used : undefined}
            obligations={ex.agentMode ? ex.result.obligations : undefined}
            confidenceReason={ex.agentMode ? ex.result.confidence_reason : undefined}
          />
        ))}
      </div>

      <footer className="mt-16 text-center text-xs text-slate-400">
        Powered by Gemini (free tier) · Pinecone · Supabase · Vercel
      </footer>
    </main>
  );
}
