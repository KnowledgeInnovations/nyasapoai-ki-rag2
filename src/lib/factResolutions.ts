/**
 * The system's own persistent reasoning memory (see migration
 * 022_fact_resolutions). Every other "intelligence" mechanism in this app —
 * the agentic tool loop, the source-reliability signal — is a stateless
 * Claude API call: nothing persists between requests, so the same conflict
 * gets re-reasoned from scratch every time the same question comes up. This
 * module is the difference between "rented intelligence, re-rented every
 * call" and "the system's own knowledge, grown once and kept."
 *
 * Two halves:
 * - lookupResolution/recordResolution: the memory itself — a resolved
 *   conflict, once reasoned through by the agentic loop, is saved and
 *   reused instead of re-derived.
 * - computeRecurringPatterns/isPatternConfirmed: turns repeated INDIVIDUAL
 *   resolutions into evidence for a GENERAL rule — once the same structured
 *   pattern is confirmed independently across enough distinct entities for
 *   a tenant, it's no longer "the LLM noticed this once," it's "the system
 *   has learned this," and becomes eligible for promotion into the
 *   deterministic extraction pipeline (see applyLearnedHeuristics in
 *   factExtraction.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalizeEntity } from './factsAnalysis'

export type ResolutionPattern =
  | 'prefer_corroborated_over_flagged'
  | 'prefer_actual_over_projection'
  | 'prefer_higher_confidence'
  | 'other'

// A pattern needs to recur across this many DISTINCT entities before it's
// treated as a confirmed, generalizable rule rather than one lucky/specific
// call — guards against promoting a rule that only happened to be right for
// one entity's particular data quirk.
const MIN_DISTINCT_ENTITIES_TO_CONFIRM = 3

export interface FactResolution {
  entity: string
  entityType: string
  metric: string
  fiscalYear: string
  resolvedValueMillions: number
  unit: string | null
  resolutionPattern: ResolutionPattern
  reasoning: string
  confidence: number
  resolvedAt: string
}

export async function lookupResolution(
  svc: SupabaseClient, tenantId: string,
  filters: { entity: string; entityType: string; metric: string; fiscalYear: string },
): Promise<FactResolution | null> {
  const entity = canonicalizeEntity(filters.entity)
  const { data } = await svc.from('fact_resolutions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('entity', entity)
    .eq('entity_type', filters.entityType)
    .eq('metric', filters.metric)
    .eq('fiscal_year', filters.fiscalYear)
    .maybeSingle()
  if (!data) return null

  // Usage counter — lets us see how much re-reasoning this table is
  // actually saving. Awaited deliberately: a fire-and-forget update here
  // can lose the race against the request finishing (confirmed live: the
  // un-awaited version never actually persisted), and this is a single
  // single-row update by id, not a meaningful latency cost.
  await svc.from('fact_resolutions').update({ use_count: (data.use_count ?? 0) + 1 }).eq('id', data.id)

  return {
    entity: data.entity, entityType: data.entity_type, metric: data.metric, fiscalYear: data.fiscal_year,
    resolvedValueMillions: data.resolved_value_millions, unit: data.unit,
    resolutionPattern: data.resolution_pattern, reasoning: data.reasoning,
    confidence: data.confidence, resolvedAt: data.resolved_at,
  }
}

export async function recordResolution(
  svc: SupabaseClient, tenantId: string,
  input: {
    entity: string; entityType: string; metric: string; fiscalYear: string
    resolvedValueMillions: number; unit?: string | null
    resolutionPattern: ResolutionPattern; reasoning: string; confidence: number
    sourceFactIds?: string[]
  },
): Promise<void> {
  const entity = canonicalizeEntity(input.entity)
  await svc.from('fact_resolutions').upsert({
    tenant_id: tenantId, entity, entity_type: input.entityType, metric: input.metric, fiscal_year: input.fiscalYear,
    resolved_value_millions: input.resolvedValueMillions, unit: input.unit ?? null,
    resolution_pattern: input.resolutionPattern, reasoning: input.reasoning, confidence: input.confidence,
    source_fact_ids: input.sourceFactIds ?? [], updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,entity,entity_type,metric,fiscal_year' })
}

export interface PatternSummary {
  pattern: ResolutionPattern
  distinctEntityCount: number
  totalOccurrences: number
  exampleReasoning: string
}

export async function computeRecurringPatterns(svc: SupabaseClient, tenantId: string): Promise<PatternSummary[]> {
  const { data } = await svc.from('fact_resolutions')
    .select('entity, resolution_pattern, reasoning')
    .eq('tenant_id', tenantId)
    .neq('resolution_pattern', 'other')
  if (!data?.length) return []

  const byPattern = new Map<ResolutionPattern, { entities: Set<string>; count: number; example: string }>()
  for (const row of data as { entity: string; resolution_pattern: ResolutionPattern; reasoning: string }[]) {
    const g = byPattern.get(row.resolution_pattern) ?? { entities: new Set(), count: 0, example: row.reasoning }
    g.entities.add(row.entity)
    g.count++
    byPattern.set(row.resolution_pattern, g)
  }

  return [...byPattern.entries()]
    .map(([pattern, g]) => ({ pattern, distinctEntityCount: g.entities.size, totalOccurrences: g.count, exampleReasoning: g.example }))
    .filter(p => p.distinctEntityCount >= MIN_DISTINCT_ENTITIES_TO_CONFIRM)
}

export async function isPatternConfirmed(svc: SupabaseClient, tenantId: string, pattern: ResolutionPattern): Promise<boolean> {
  const patterns = await computeRecurringPatterns(svc, tenantId)
  return patterns.some(p => p.pattern === pattern)
}
