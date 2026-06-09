export type UserRole = 'admin' | 'exco' | 'senior_manager' | 'staff'

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
  document_chunk_id: string
  document_title: string
  chunk_text: string
  relevance_score: number
  // [start, end) character offsets within chunk_text for the sentence that
  // best matches the user's question — null if no clear match was found
  highlight?: [number, number] | null
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

export interface RAGResponse {
  answer: string
  citations: Citation[]
  confidence_score: number
  risks: string[]
  recommendations: string[]
}
