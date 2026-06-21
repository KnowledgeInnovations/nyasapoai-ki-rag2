export type UserRole = 'senior' | 'middle' | 'junior'

export interface Tenant {
  id: string
  name: string
  subdomain: string
  plan: 'starter' | 'professional' | 'enterprise'
  created_at: string
}

export interface User {
  id: string
  email: string
  name: string
  avatar_url?: string
}

export interface Membership {
  user_id: string
  tenant_id: string
  role: UserRole
}

export interface Document {
  id: string
  tenant_id: string
  title: string
  source: string
  department?: string
  sensitivity: 'public' | 'internal' | 'confidential' | 'restricted'
  status: 'processing' | 'ready' | 'failed'
  created_at: string
  updated_at: string
}

export interface DocumentChunk {
  id: string
  document_id: string
  chunk_text: string
  chunk_index: number
  metadata: Record<string, unknown>
  created_at: string
}

export interface Conversation {
  id: string
  user_id: string
  tenant_id: string
  query: string
  response: string
  confidence_score?: number
  created_at: string
}

export interface Citation {
  id: string
  conversation_id: string
  // null for fact-based citations (financial_facts/document_facts rows
  // backed by no real chunk — see migration 017) — relevance_score on those
  // is the fact's extraction confidence (0-1), not a retrieval similarity.
  document_chunk_id: string | null
  document_id: string
  document_title: string
  chunk_text: string
  relevance_score: number
  // [start, end) character offsets within chunk_text for the sentence that
  // best matches the user's question — null if no clear match was found
  highlight?: [number, number] | null
  page_number?: number | null
  section_title?: string | null
  // Index into conversations.messages of the AI message that cited this
  // chunk — used to restore citations to the right message on reload.
  message_index?: number | null
}

export interface AuditLog {
  id: string
  tenant_id: string
  user_id: string
  action: string
  resource_type: string
  resource_id?: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface ChartPoint {
  year: number
  value: number
  // true for projected/forecast points, omitted for historical points
  projected?: boolean
}

export interface ChartData {
  title: string
  unit: string
  series: ChartPoint[]
}

export interface RAGResponse {
  answer: string
  citations: Citation[]
  confidence_score: number
  confidence_level?: 'High' | 'Medium' | 'Low'
  risks: string[]
  recommendations: string[]
  chart?: ChartData | null
}
