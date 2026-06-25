/**
 * Self-improvement, phase 2 (Day 3): turns the corroboration/supersession
 * flags already written onto financial_facts (duplicate_extraction,
 * alternate_estimate, conflicting_national_value, anomalous_growth,
 * unit_outlier_in_series, superseded_by_actual, forward_projection) into a
 * per-document reliability signal — "of this document's extracted figures,
 * what fraction came out clean vs. flagged." This doesn't change retrieval
 * ranking (too risky to touch the core hybrid-search RPC every query
 * depends on for a same-night change) — it's surfaced only through the
 * agentic tools, as a tie-breaker the model can use when reasoning about
 * which of two conflicting documents to trust more.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface DocumentReliability {
  documentId: string
  title: string
  cleanCount: number
  flaggedCount: number
  // cleanCount / (cleanCount + flaggedCount), 0-1. Undefined for documents
  // with zero extracted facts — "unknown" is not the same claim as
  // "unreliable", so callers should treat a missing entry as no signal
  // rather than defaulting it to 0.
  reliabilityScore: number
}

export async function computeDocumentReliability(
  svc: SupabaseClient, tenantId: string, documentIds: string[],
): Promise<Map<string, DocumentReliability>> {
  const result = new Map<string, DocumentReliability>()
  if (!documentIds.length) return result

  const { data: facts } = await svc.from('financial_facts')
    .select('document_id, confidence, flags')
    .eq('tenant_id', tenantId)
    .in('document_id', documentIds)
  if (!facts?.length) return result

  const counts = new Map<string, { clean: number; flagged: number }>()
  for (const f of facts as { document_id: string; confidence: number; flags: string[] | null }[]) {
    const c = counts.get(f.document_id) ?? { clean: 0, flagged: 0 }
    if (f.flags?.length) c.flagged++
    else if (f.confidence >= 70) c.clean++
    counts.set(f.document_id, c)
  }

  const { data: docs } = await svc.from('documents').select('id, title').in('id', documentIds)
  const titleById = new Map((docs ?? []).map(d => [d.id, d.title]))

  for (const [documentId, c] of counts) {
    const total = c.clean + c.flagged
    if (total === 0) continue
    result.set(documentId, {
      documentId, title: titleById.get(documentId) ?? 'Document',
      cleanCount: c.clean, flaggedCount: c.flagged,
      reliabilityScore: Math.round((c.clean / total) * 100) / 100,
    })
  }
  return result
}
