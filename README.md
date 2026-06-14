# ComplianceAgent — Phase 1 MVP

Multi-domain agentic RAG compliance tool. Upload a regulatory circular (PDF
or pasted text), ask compliance questions, get answers grounded in the
source with citations, and export an audit report.

## Stack (all free-tier)

- **LLM**: Gemini API (`gemini-2.5-flash` for generation,
  `text-embedding-004` for embeddings) — genuinely free, no card required.
  An optional Claude path is wired in (`lib/llm.ts`) for when you want
  higher-quality generation in production; Claude API has no permanent free
  tier, so it's off by default.
- **Vector store**: Pinecone serverless free tier (one index,
  `complianceagent`, 768 dimensions to match `text-embedding-004`).
- **Database / audit logs**: Supabase free tier (Postgres).
- **Hosting**: Vercel.

## Project structure

```
app/
  page.tsx              # Single-page UI: upload, ask, audit report
  layout.tsx
  globals.css
  api/
    ingest/route.ts      # Parse → chunk → embed → upsert to Pinecone + log to Supabase
    query/route.ts       # Embed question → retrieve → generate cited answer
    audit/route.ts        # Generate formal audit-trail narrative + persist
    health/route.ts        # Verify env vars are configured
components/
  UploadPanel.tsx
  QueryPanel.tsx
  AnswerCard.tsx
lib/
  llm.ts                # Gemini (+ optional Claude) abstraction
  pinecone.ts           # Index management, upsert, query
  supabase.ts           # Server-side Supabase client + helpers
  chunking.ts           # Paragraph-aware chunker with overlap
  pdf.ts                # PDF text extraction
  types.ts              # Shared types
supabase/
  schema.sql            # Run this in the Supabase SQL editor
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Get free API keys

- **Gemini**: https://aistudio.google.com/app/apikey — sign in with a Google
  account, no billing required.
- **Pinecone**: https://app.pinecone.io — free serverless project. You don't
  need to pre-create the index; `lib/pinecone.ts` creates it on first run if
  missing (768 dims, cosine, AWS us-east-1 — matches the free-tier
  constraints).
- **Supabase**: https://supabase.com — create a free project, then run
  `supabase/schema.sql` in the SQL editor (Project → SQL Editor → New query).
  Grab the **Project URL** and **service_role** key from Project Settings →
  API.

### 3. Configure environment

```bash
cp .env.example .env.local
```

Fill in `GEMINI_API_KEY`, `PINECONE_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`. Leave `LLM_PROVIDER=gemini` for the free path.

### 4. Run locally

```bash
npm run dev
```

Visit http://localhost:3000. Check `/api/health` to confirm all three
services are configured correctly.

## Working in Cursor

This is a standard Next.js 14 App Router project — Cursor will pick up the
structure immediately. Suggested order of work for Phase 1:

1. Run `npm install`, fill in `.env.local`, confirm `/api/health` returns
   `ok: true`.
2. Test ingestion: paste a short circular via the UI, confirm it appears
   under "Indexed documents" and check the Pinecone console for the new
   vectors.
3. Test query: ask a question covered by the pasted text, confirm the
   answer cites the right chunk.
4. Test audit report: click "Generate audit report", confirm the `.txt`
   download and the `audit_reports` row in Supabase.
5. Iterate on prompt wording in `lib/llm.ts` (`SYSTEM_PROMPT`) using your
   validated 5-phase prompt pipeline — this is the highest-leverage file for
   answer quality.

## Deploying to Vercel

1. Push this repo to GitHub.
2. In Vercel, "Add New Project" → import the repo.
3. Add the same environment variables from `.env.local` under Project
   Settings → Environment Variables (all environments).
4. Deploy. Cold starts will lazily create the Pinecone index on first
   `/api/ingest` call — this can take a few seconds the very first time.

## Known Phase 1 limitations (by design, for MVP scope)

- PDF extraction is text-based only — scanned/image PDFs need OCR (Phase 2).
- Embeddings are generated sequentially to stay within Gemini's free-tier
  rate limits; large documents (100+ chunks) will take noticeably longer to
  ingest.
- No auth/multi-tenant isolation yet — every document is queryable by every
  user. Add Supabase Auth + Pinecone namespaces per org for Phase 2.
- Audit reports are downloaded as plain text; swap in the `pdf` skill /
  `pdf-lib` for a formatted PDF export in Phase 2.
