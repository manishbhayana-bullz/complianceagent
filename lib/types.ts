export interface DocumentRecord {
  id: string;
  title: string;
  domain: string; // e.g. "RBI", "SEBI", "GDPR", "Internal Policy"
  source_type: 'pdf' | 'text';
  uploaded_at: string;
  chunk_count: number;
}

export interface ChunkMetadata {
  doc_id: string;
  title: string;
  domain: string;
  chunk_index: number;
  text: string;
  clause_ref?: string; // e.g. "Para 4.2" if detected
}

export interface RetrievedChunk {
  id: string;
  score: number;
  metadata: ChunkMetadata;
}

export interface Citation {
  doc_id: string;
  title: string;
  clause_ref?: string;
  chunk_index: number;
  excerpt: string;
}

export interface QueryAnswer {
  answer: string;
  citations: Citation[];
  confidence: 'high' | 'medium' | 'low';
  retrieved_chunks: RetrievedChunk[];
}

export interface AuditReport {
  question: string;
  answer: string;
  citations: Citation[];
  confidence: 'high' | 'medium' | 'low';
  generated_at: string;
  domains_covered: string[];
  disclaimer: string;
}

// --- Phase 3: Agent orchestrator ---

/** One entry in the agent's tool-call trail, surfaced for transparency/audit. */
export interface ToolCallRecord {
  tool: string;
  input: Record<string, unknown>;
  output_summary: string;
}

export interface Obligation {
  description: string;
  source_doc_id?: string;
  clause_ref?: string;
}

/**
 * Reserved for Milestone 2 (conflict detection / compare_obligations).
 * The orchestrator's output schema always includes this field so the
 * response shape is stable across milestones, but it is always [] until
 * compare_obligations is wired in.
 */
export interface Conflict {
  topic: string;
  nature: string;
  takes_precedence?: string;
  action_required: string;
}

export interface AgentAnswer {
  reasoning: string;
  tools_used: ToolCallRecord[];
  answer: string;
  citations: Citation[];
  obligations: Obligation[];
  conflicts: Conflict[];
  confidence: 'high' | 'medium' | 'low';
  confidence_reason: string;
  retrieved_chunks: RetrievedChunk[];
}
