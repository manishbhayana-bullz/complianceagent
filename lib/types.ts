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
