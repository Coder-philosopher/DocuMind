export type DocumentStatus = "processing" | "ready" | "failed";

export interface DocumentRecord {
  id: string;
  filename: string;
  file_type: string;
  uploaded_at: string;
  status: DocumentStatus;
  page_count: number | null;
}

export interface ChunkRecord {
  id: string;
  document_id: string;
  content: string;
  page_number: number | null;
  chunk_index: number;
  token_count: number;
}

export interface Citation {
  chunk_id: string;
  snippet: string;
  page: number | null;
  document_id?: string;
  document_name?: string;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  grounding_score: number | null;
  created_at: string;
}

export interface ConversationRecord {
  id: string;
  title: string;
  created_at: string;
}

export interface RetrievalResult {
  chunkId: string;
  documentId: string;
  content: string;
  pageNumber: number | null;
  chunkIndex: number;
  similarity: number;
  ftsRank: number;
  documentName?: string;
}

export interface AgentStep {
  icon?: string;
  label: string;
  detail?: string;
  durationMs?: number;
}

export interface AnswerResult {
  content: string;
  citations: Citation[];
  groundingScore: number;
  agentSteps: AgentStep[];
}