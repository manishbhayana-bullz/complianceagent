import { createClient } from '@supabase/supabase-js';
import type { DocumentRecord, AuditReport } from './types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[lib/supabase] Supabase URL or service role key is not set.'
  );
}

// Server-side client only — uses the service role key, never expose to the browser.
export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export async function insertDocument(doc: DocumentRecord & { user_id: string }): Promise<void> {
  const { error } = await supabase.from('documents').insert({
    id: doc.id,
    title: doc.title,
    domain: doc.domain,
    source_type: doc.source_type,
    uploaded_at: doc.uploaded_at,
    chunk_count: doc.chunk_count,
    user_id: doc.user_id,
  });
  if (error) throw error;
}

export async function listDocuments(userId: string): Promise<DocumentRecord[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return data as DocumentRecord[];
}

/**
 * Fetches a single document by id. Used by the delete route to confirm the
 * document exists and to read its chunk_count before deleting the matching
 * Pinecone vectors.
 */
export async function getDocument(
  id: string,
  userId: string
): Promise<DocumentRecord | null> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as DocumentRecord) ?? null;
}

export async function deleteDocument(id: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function insertQueryLog(params: {
  question: string;
  answer: string;
  confidence: string;
  citations: unknown;
}): Promise<string> {
  const { data, error } = await supabase
    .from('query_logs')
    .insert({
      question: params.question,
      answer: params.answer,
      confidence: params.confidence,
      citations: params.citations,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function insertAuditReport(
  queryLogId: string,
  report: AuditReport
): Promise<void> {
  const { error } = await supabase.from('audit_reports').insert({
    query_log_id: queryLogId,
    question: report.question,
    answer: report.answer,
    citations: report.citations,
    domains_covered: report.domains_covered,
    generated_at: report.generated_at,
    disclaimer: report.disclaimer,
  });
  if (error) throw error;
}
// ADD — new function for the usage_log table (this is the core Phase A ask)
export async function insertUsageLog(params: {
  userId: string;
  actionType: 'ingest' | 'query' | 'agent' | 'export';
  documentId?: string;
  tokensUsed?: number;
}): Promise<void> {
  const { error } = await supabase.from('usage_log').insert({
    user_id: params.userId,
    action_type: params.actionType,
    document_id: params.documentId,
    tokens_used: params.tokensUsed,
  });
  if (error) throw error;
}
