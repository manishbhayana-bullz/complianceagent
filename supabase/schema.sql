-- Run this in the Supabase SQL editor to set up Phase 1 tables.

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  domain text not null,
  source_type text not null check (source_type in ('pdf', 'text')),
  uploaded_at timestamptz not null default now(),
  chunk_count integer not null default 0
);

create table if not exists query_logs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists audit_reports (
  id uuid primary key default gen_random_uuid(),
  query_log_id uuid references query_logs(id) on delete cascade,
  question text not null,
  answer text not null,
  citations jsonb not null default '[]'::jsonb,
  domains_covered text[] not null default array[]::text[],
  generated_at timestamptz not null default now(),
  disclaimer text not null default ''
);

-- Optional: enable Row Level Security and allow service role full access only.
alter table documents enable row level security;
alter table query_logs enable row level security;
alter table audit_reports enable row level security;

create policy "service role full access documents" on documents
  for all using (auth.role() = 'service_role');
create policy "service role full access query_logs" on query_logs
  for all using (auth.role() = 'service_role');
create policy "service role full access audit_reports" on audit_reports
  for all using (auth.role() = 'service_role');
