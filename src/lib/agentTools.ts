/**
 * Agentic RAG, Day 1: tool definitions for Claude's native tool-use, so the
 * model can decide what to retrieve/compute/verify next instead of following
 * one hard-coded retrieve -> generate -> verify sequence. Each tool wraps
 * EXISTING, already-tested logic (factsAnalysis.ts's deterministic
 * computations, the same hybrid-search RPC, the same validated-facts
 * filter) — this file adds a callable surface, not new analytical logic.
 *
 * Kept deliberately separate from chat/route.ts's existing pipeline (the
 * pre-computed-blocks + single-shot generation path) rather than replacing
 * it — that path is heavily tuned and serves simple questions well. The
 * agentic loop (agenticAnswer.ts) is an additive capability, not a rip-and-
 * replace.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  canonicalizeEntity, dedupeFacts, cumulativeByEntity, topNGrowth, proportionOfTotal,
  summarizeTrend, forecastNextYear, type FactRow,
} from './factsAnalysis'
import { computeDocumentReliability } from './sourceReliability'

const FACTS_SELECT = 'fiscal_year, entity, entity_type, metric, value, unit, value_millions, page_number, section_title, document_id, confidence, flags'

// Appended to the existing core system prompt for the agentic path only —
// the base prompt was written for the single-shot pipeline and has no
// concept of tools beyond their schema descriptions. Without this, Claude
// technically CAN call tools but has no guidance on which one fits which
// situation, or that it should prefer verifying over guessing.
export const AGENTIC_SYSTEM_ADDENDUM = `

You have tools available: lookup_financial_fact, compute_aggregate, search_documents, verify_figure. Use them deliberately, not reflexively:
- If the document excerpts already contain a clear, well-cited figure, you do not need to call a tool just to double-check something obvious — that wastes a turn.
- Before stating a specific number that is NOT already verbatim in an excerpt shown to you (e.g. you are about to round, recompute, or recall it from a structured block), call verify_figure first. If it comes back unsupported or conflicting, say so in your answer rather than asserting the number with confidence.
- When lookup_financial_fact or verify_figure return conflicting values from different source documents, each conflicting entry includes that document's reliability_score (the fraction of ITS OWN extracted figures that came out clean elsewhere, not a judgment on this specific figure) — treat it as a tie-breaker, not proof. Prefer the higher-reliability source if you must pick one, but disclose the conflict either way.
- For "how much / what was the total / cumulative / top N / proportion / trend / forecast" style questions, call compute_aggregate rather than summing or comparing numbers yourself — your own arithmetic over many rows is exactly the kind of step that should be delegated to a deterministic tool.
- If the initial excerpts don't actually cover what's being asked, call search_documents with a focused, narrower query rather than answering from a weak match.
- You have a limited number of tool-call rounds. Once you have enough to answer responsibly — including being explicit about what you couldn't confirm — stop calling tools and answer.`

// ── Tool schemas (Anthropic tool-use format) ────────────────────────────

export const AGENT_TOOLS = [
  {
    name: 'lookup_financial_fact',
    description: 'Look up a specific validated financial figure (allocation, revenue, debt, etc.) for a named entity (e.g. "Ministry of Education", "National") and optional fiscal year. Returns validated figures only, plus any known conflicting/flagged values for the same entity+year so you can reason about discrepancies. Use this instead of guessing a number from document excerpts when you need an exact, structured figure.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity: { type: 'string', description: 'Entity name, e.g. "Ministry of Education" or "National"' },
        metric: { type: 'string', description: 'Optional metric filter, e.g. "allocation", "total_budget", "revenue", "debt"' },
        fiscal_year: { type: 'string', description: 'Optional 4-digit fiscal year, e.g. "2026"' },
      },
      required: ['entity'],
    },
  },
  {
    name: 'compute_aggregate',
    description: 'Run a deterministic computation over validated financial facts: cumulative totals over a year range, top-N growth ranking, proportion of national total, a trend summary, or a next-year forecast. Always prefer this over manually summing/comparing numbers yourself — it uses the same vetted logic as the rest of the system and will tell you when data is missing rather than guessing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['cumulative', 'top_growth', 'proportion', 'trend', 'forecast'] },
        entity: { type: 'string', description: 'Required for proportion/trend/forecast; ignored for cumulative/top_growth (which rank across all entities of entityType)' },
        entityType: { type: 'string', enum: ['national', 'ministry', 'sector'], description: 'Defaults to "ministry" if omitted' },
        metric: { type: 'string', description: 'e.g. "allocation", "total_budget"' },
        from: { type: 'number', description: 'Start fiscal year (cumulative/top_growth/trend)' },
        to: { type: 'number', description: 'End fiscal year (cumulative/top_growth/trend)' },
        year: { type: 'number', description: 'Single fiscal year (proportion)' },
      },
      required: ['type', 'metric'],
    },
  },
  {
    name: 'search_documents',
    description: 'Re-run document search with a refined query — use this when the initial excerpts don\'t cover what you need, or you want to look for a specific named programme/figure not already in front of you.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'A focused search query, e.g. "GETFund allocation 2026" rather than the full original question' },
      },
      required: ['query'],
    },
  },
  {
    name: 'verify_figure',
    description: 'Check a specific number you are about to state against the validated facts store BEFORE including it in your answer. Returns whether it is supported, and if not, what the closest known validated value actually is (or whether multiple conflicting values exist). Use this on any figure you are not 100% sure is verbatim from an excerpt already shown to you.',
    input_schema: {
      type: 'object' as const,
      properties: {
        value: { type: 'number', description: 'The raw figure as you intend to state it (e.g. 39233795022)' },
        entity: { type: 'string', description: 'The entity the figure belongs to' },
        fiscal_year: { type: 'string', description: 'The fiscal year the figure belongs to' },
      },
      required: ['value', 'entity'],
    },
  },
]

// ── Shared fact-fetching (mirrors chat/route.ts's validFacts pattern) ───

async function fetchValidatedFacts(
  svc: SupabaseClient, tenantId: string,
  filters: { entity?: string; metric?: string; fiscal_year?: string; entityType?: string },
): Promise<FactRow[]> {
  let q = svc.from('financial_facts').select(FACTS_SELECT).eq('tenant_id', tenantId).gte('confidence', 70).limit(500)
  if (filters.entity) q = q.ilike('entity', `%${filters.entity}%`)
  if (filters.metric) q = q.eq('metric', filters.metric)
  if (filters.fiscal_year) q = q.eq('fiscal_year', filters.fiscal_year)
  if (filters.entityType) q = q.eq('entity_type', filters.entityType)
  const { data } = await q
  return ((data ?? []) as FactRow[]).filter(f => !(f.flags?.length))
}

async function fetchAllFactsForEntity(
  svc: SupabaseClient, tenantId: string,
  filters: { entity?: string; metric?: string; fiscal_year?: string; entityType?: string },
): Promise<FactRow[]> {
  let q = svc.from('financial_facts').select(FACTS_SELECT).eq('tenant_id', tenantId).limit(500)
  if (filters.entity) q = q.ilike('entity', `%${filters.entity}%`)
  if (filters.metric) q = q.eq('metric', filters.metric)
  if (filters.fiscal_year) q = q.eq('fiscal_year', filters.fiscal_year)
  if (filters.entityType) q = q.eq('entity_type', filters.entityType)
  const { data } = await q
  return (data ?? []) as FactRow[]
}

// ── Tool executors ───────────────────────────────────────────────────────

export interface AgentToolContext {
  svc: SupabaseClient
  tenantId: string
}

export async function executeLookupFinancialFact(ctx: AgentToolContext, input: { entity: string; metric?: string; fiscal_year?: string }) {
  const clean = await fetchValidatedFacts(ctx.svc, ctx.tenantId, input)
  const all = await fetchAllFactsForEntity(ctx.svc, ctx.tenantId, input)
  const flagged = all.filter(f => f.flags?.length && !clean.includes(f))

  const flaggedDocIds = [...new Set(flagged.map(f => f.document_id).filter((id): id is string => !!id))]
  const reliability = flaggedDocIds.length ? await computeDocumentReliability(ctx.svc, ctx.tenantId, flaggedDocIds) : new Map()

  return {
    validated: clean.slice(0, 20).map(f => ({
      entity: f.entity, metric: f.metric, fiscal_year: f.fiscal_year,
      value_millions: f.value_millions, unit: f.unit, confidence: f.confidence,
      source_document_id: f.document_id, page: f.page_number,
    })),
    conflicting_or_flagged: flagged.slice(0, 10).map(f => ({
      entity: f.entity, metric: f.metric, fiscal_year: f.fiscal_year,
      value_millions: f.value_millions, flags: f.flags, confidence: f.confidence,
      source_reliability: f.document_id ? reliability.get(f.document_id)?.reliabilityScore : undefined,
    })),
    note: clean.length === 0
      ? 'No validated figure found for this entity/metric/year. Do not guess — say so, or check flagged values below for context only (never state a flagged value as fact).'
      : undefined,
  }
}

export async function executeComputeAggregate(ctx: AgentToolContext, input: {
  type: 'cumulative' | 'top_growth' | 'proportion' | 'trend' | 'forecast'
  entity?: string; entityType?: string; metric: string; from?: number; to?: number; year?: number
}) {
  const entityType = input.entityType ?? 'ministry'
  const facts = await fetchValidatedFacts(ctx.svc, ctx.tenantId, { metric: input.metric, entityType })

  switch (input.type) {
    case 'cumulative': {
      if (input.from == null || input.to == null) return { error: 'cumulative requires from and to' }
      const entries = cumulativeByEntity(facts, { entityType, metric: input.metric, from: input.from, to: input.to })
      return { entries }
    }
    case 'top_growth': {
      if (input.from == null || input.to == null) return { error: 'top_growth requires from and to' }
      const entries = topNGrowth(facts, { entityType, metric: input.metric, from: input.from, to: input.to })
      return { entries }
    }
    case 'proportion': {
      if (!input.entity || input.year == null) return { error: 'proportion requires entity and year' }
      const range = { from: (input.from ?? input.year - 5), to: (input.to ?? input.year) }
      const result = proportionOfTotal(facts, { entity: input.entity, entityType, metric: input.metric, year: input.year, range })
      return result ?? { error: 'No proportion computable — missing entity or national total for this year' }
    }
    case 'trend': {
      if (!input.entity || input.from == null || input.to == null) return { error: 'trend requires entity, from, and to' }
      const result = summarizeTrend(facts, { entityType, entity: input.entity, metric: input.metric, from: input.from, to: input.to })
      return result ?? { error: 'No trend computable — insufficient validated data points' }
    }
    case 'forecast': {
      if (!input.entity) return { error: 'forecast requires entity' }
      const result = forecastNextYear(facts, { entityType, entity: input.entity, metric: input.metric })
      return result ?? { error: 'No forecast computable — insufficient validated data points' }
    }
    default:
      return { error: `Unknown aggregate type: ${input.type}` }
  }
}

export async function executeSearchDocuments(ctx: AgentToolContext, input: { query: string }) {
  const embRes = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: input.query }),
  })
  const embData = await embRes.json()
  const queryEmbedding = embData.data?.[0]?.embedding
  if (!queryEmbedding) return { error: 'Search failed (embedding error)' }

  const { data } = await ctx.svc.rpc('match_document_chunks_hybrid', {
    query_embedding: queryEmbedding, query_text: input.query, p_tenant_id: ctx.tenantId,
    match_count: 8, p_platform_tenant_id: null,
  })
  type Chunk = { document_id: string; chunk_text: string; metadata: Record<string, unknown> }
  const chunks = (data ?? []) as Chunk[]
  if (!chunks.length) return { results: [], note: 'No matching excerpts found for this query.' }

  const { data: docs } = await ctx.svc.from('documents').select('id, title').in('id', [...new Set(chunks.map(c => c.document_id))])
  const titleById = new Map((docs ?? []).map(d => [d.id, d.title]))

  return {
    results: chunks.slice(0, 6).map(c => ({
      document: titleById.get(c.document_id) ?? 'Unknown',
      page: c.metadata?.page_number ?? null,
      excerpt: c.chunk_text.slice(0, 800),
    })),
  }
}

export async function executeVerifyFigure(ctx: AgentToolContext, input: { value: number; entity: string; fiscal_year?: string }) {
  const facts = await fetchValidatedFacts(ctx.svc, ctx.tenantId, { entity: input.entity, fiscal_year: input.fiscal_year })
  if (!facts.length) {
    return { supported: false, note: 'No validated facts at all for this entity/year — cannot confirm or deny this figure from structured data. Check document excerpts directly.' }
  }

  // Same tolerance logic as verifyAnswer's factMatch (~1%), normalized to millions.
  const valueAsMillions = [input.value, input.value / 1e6, input.value / 1e3].find(v => v > 0.001 && v < 1e7) ?? input.value
  const candidates = [input.value, valueAsMillions]
  for (const v of candidates) {
    const match = facts.find(f => f.value_millions != null && f.value_millions !== 0 &&
      Math.abs(f.value_millions - v) / Math.abs(f.value_millions) <= 0.01)
    if (match) {
      return { supported: true, matched_value_millions: match.value_millions, entity: match.entity, fiscal_year: match.fiscal_year, confidence: match.confidence }
    }
  }

  const distinct = new Map<number, string | null>()
  for (const f of facts) {
    if (f.value_millions != null && !distinct.has(f.value_millions)) distinct.set(f.value_millions, f.document_id ?? null)
  }
  const docIds = [...new Set([...distinct.values()].filter((id): id is string => !!id))]
  const reliability = docIds.length ? await computeDocumentReliability(ctx.svc, ctx.tenantId, docIds) : new Map()

  return {
    supported: false,
    closest_validated_values_millions: [...distinct.entries()].slice(0, 5).map(([value_millions, documentId]) => ({
      value_millions, source_reliability: documentId ? reliability.get(documentId)?.reliabilityScore : undefined,
    })),
    note: distinct.size > 1
      ? 'Multiple different validated values exist for this entity/year — this figure matches none of them closely. Consider disclosing the discrepancy rather than asserting one number.'
      : 'This figure does not match the validated value for this entity/year.',
  }
}

export async function executeAgentTool(ctx: AgentToolContext, name: string, input: Record<string, unknown>) {
  switch (name) {
    case 'lookup_financial_fact': return executeLookupFinancialFact(ctx, input as { entity: string; metric?: string; fiscal_year?: string })
    case 'compute_aggregate': return executeComputeAggregate(ctx, input as Parameters<typeof executeComputeAggregate>[1])
    case 'search_documents': return executeSearchDocuments(ctx, input as { query: string })
    case 'verify_figure': return executeVerifyFigure(ctx, input as { value: number; entity: string; fiscal_year?: string })
    default: return { error: `Unknown tool: ${name}` }
  }
}

// canonicalizeEntity/dedupeFacts re-exported for callers that want the same
// entity-name normalization the tools use internally (e.g. agenticAnswer.ts
// formatting tool results for citations).
export { canonicalizeEntity, dedupeFacts }
