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
import { lookupResolution, recordResolution, type ResolutionPattern } from './factResolutions'

const FACTS_SELECT = 'fiscal_year, entity, entity_type, metric, value, unit, value_millions, page_number, section_title, document_id, confidence, flags'
const DOC_FACTS_SELECT = 'id, document_id, category, subject, attribute, value_text, unit, page_number, section_title, confidence'

interface DocFactRow {
  id: string
  document_id: string
  category: string | null
  subject: string | null
  attribute: string | null
  value_text: string
  unit: string | null
  page_number: number | null
  section_title: string | null
  confidence: number
}

// Appended to the existing core system prompt for the agentic path only —
// the base prompt was written for the single-shot pipeline and has no
// concept of tools beyond their schema descriptions. Without this, Claude
// technically CAN call tools but has no guidance on which one fits which
// situation, or that it should prefer verifying over guessing.
export const AGENTIC_SYSTEM_ADDENDUM = `

You have tools available: lookup_financial_fact, compute_aggregate, search_documents, verify_figure, record_resolution. Use them deliberately, not reflexively:
- If the document excerpts already contain a clear, well-cited figure, you do not need to call a tool just to double-check something obvious — that wastes a turn.
- Before stating a specific number that is NOT already verbatim in an excerpt shown to you (e.g. you are about to round, recompute, or recall it from a structured block), call verify_figure first. If it comes back unsupported or conflicting, say so in your answer rather than asserting the number with confidence.
- This applies just as much to a comparison or benchmark figure you're adding as supporting context (e.g. citing a market/industry benchmark alongside a property's or product's own numbers) as it does to the main figure the question is about — these are often pulled from a chart or table where the labels and values extracted as separate, scattered text, so a value can easily get attached to the wrong label. Call verify_figure on each one before stating it, even if the question wasn't directly about that figure.
- When lookup_financial_fact or verify_figure return conflicting values from different source documents, each conflicting entry includes that document's reliability_score (the fraction of ITS OWN extracted figures that came out clean elsewhere, not a judgment on this specific figure) — treat it as a tie-breaker, not proof. Prefer the higher-reliability source if you must pick one, but disclose the conflict either way.
- If lookup_financial_fact returns a previous_resolution field, this exact conflict was already resolved before — use that resolution directly (cite its reasoning) instead of re-deriving it from scratch. Don't call record_resolution again for the same entity/metric/year unless you've genuinely found new evidence that changes the answer.
- If lookup_financial_fact returned conflicting_or_flagged values (no previous_resolution) and you've worked out which one is actually correct and why, call record_resolution to save that reasoning — this is the system's own permanent memory, not a scratch note, so the same conflict never needs to be re-reasoned from zero again. Pick the resolution_pattern that genuinely matches your reasoning; if none of the structured patterns fit, use "other" rather than forcing a mismatch.
- For "how much / what was the total / cumulative / top N / proportion / trend / forecast" style questions, call compute_aggregate rather than summing or comparing numbers yourself — your own arithmetic over many rows is exactly the kind of step that should be delegated to a deterministic tool.
- If the initial excerpts don't actually cover what's being asked, call search_documents with a focused, narrower query rather than answering from a weak match.
- You have a limited number of tool-call rounds. Once you have enough to answer responsibly — including being explicit about what you couldn't confirm — stop calling tools and answer.`

// ── Tool schemas (Anthropic tool-use format) ────────────────────────────

export const AGENT_TOOLS = [
  {
    name: 'lookup_financial_fact',
    description: 'Look up a specific validated figure for a named entity/subject (e.g. "Ministry of Education", "National", "Ghana Stock Market", "The Address") and optional fiscal year. Checks the financial_facts store (budget/allocation-style figures) first; if this tenant has none for the entity, falls back to the generic document_facts store (any extracted figure — property prices, benchmark returns, unit counts, etc.) and returns matching rows there instead. Use this instead of guessing a number from document excerpts when you need an exact, structured figure.',
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
    description: 'Check a specific number you are about to state against the validated facts store BEFORE including it in your answer — checks financial_facts, and for tenants/subjects with none, falls back to document_facts (any extracted figure, e.g. a benchmark return, price, or count named in a table or chart). Returns whether it is supported, and if not, what the closest known validated value actually is (or whether multiple conflicting values exist). Use this on any figure you are not 100% sure is verbatim from an excerpt already shown to you — this is ESPECIALLY important for a number you are recalling from a chart or table, since those often extract as scattered/jumbled text and are easy to mis-pair with the wrong label.',
    input_schema: {
      type: 'object' as const,
      properties: {
        value: { type: 'number', description: 'The raw figure as you intend to state it (e.g. 39233795022, or 13.1 for "13.1%")' },
        entity: { type: 'string', description: 'The entity/subject the figure belongs to, e.g. "Ministry of Education" or "Ghana Stock Market"' },
        fiscal_year: { type: 'string', description: 'The fiscal year the figure belongs to' },
      },
      required: ['value', 'entity'],
    },
  },
  {
    name: 'record_resolution',
    description: 'Save a conflict resolution permanently so this exact (entity, metric, fiscal_year) conflict never needs to be re-reasoned from scratch again — this is the system\'s own persistent memory, not a scratch note. Only call this after you have genuinely worked out which of several conflicting/flagged figures is correct and why, using lookup_financial_fact or verify_figure first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity: { type: 'string', description: 'Entity name, e.g. "Ministry of Education" or "National"' },
        entity_type: { type: 'string', enum: ['national', 'ministry', 'sector'] },
        metric: { type: 'string', description: 'e.g. "allocation", "total_budget"' },
        fiscal_year: { type: 'string', description: '4-digit fiscal year, e.g. "2009"' },
        resolved_value_millions: { type: 'number', description: 'The figure you determined to be correct, in millions' },
        unit: { type: 'string', description: 'e.g. "million" or "billion" — whatever unit the resolved figure is denominated in' },
        resolution_pattern: {
          type: 'string',
          enum: ['prefer_corroborated_over_flagged', 'prefer_actual_over_projection', 'prefer_higher_confidence', 'other'],
          description: 'prefer_corroborated_over_flagged: you chose a figure corroborated by document text or cross-document agreement over one flagged as a duplicate/alternate/anomalous extraction, even if the flagged one had a higher raw confidence number. prefer_actual_over_projection: you chose an actual reported figure over a forward projection/forecast for the same year. prefer_higher_confidence: you simply went with whichever validated figure had higher confidence, no deeper pattern. other: your reasoning does not cleanly match any of the above.',
        },
        reasoning: { type: 'string', description: 'A concise explanation of why this value is correct, for future reference' },
        confidence: { type: 'number', description: 'Your confidence (0-100) in this resolution' },
      },
      required: ['entity', 'entity_type', 'metric', 'fiscal_year', 'resolved_value_millions', 'resolution_pattern', 'reasoning', 'confidence'],
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

// document_facts fallback — the generic, category/subject/attribute/value_text
// shaped extraction store used for non-budget tenants (e.g. real estate, SOPs)
// that have no financial_facts at all. Without this, lookup_financial_fact
// and verify_figure are dead tools for any such tenant: every call returns
// "no validated facts", so the model never gets a chance to double-check a
// figure before stating it and falls back on raw, sometimes ambiguous chunk
// text. Confirmed live: a sales-pitch answer stated "Ghana Stock Market
// 13.1%, Ghana T-Bill 11.00%" — the actual extracted document_facts rows
// were "Ghana Stock Market -1.6%, Ghana T-Bill 1.4%" (S&P 500 was 13.1%) —
// the model had mis-paired labels to values while reading a chart that had
// extracted as scattered text, and had no tool available that could have
// caught it. Matched by subject substring (not an exact key like entity/
// fiscal_year — document_facts has no fiscal_year concept), scoped to the
// tenant only (no document_id scoping — verify_figure/lookup_financial_fact
// are asked about a specific claim, not a specific document).
async function fetchValidatedDocFacts(svc: SupabaseClient, tenantId: string, subject: string): Promise<DocFactRow[]> {
  const { data } = await svc.from('document_facts').select(DOC_FACTS_SELECT)
    .eq('tenant_id', tenantId).gte('confidence', 70).ilike('subject', `%${subject}%`).limit(50)
  return (data ?? []) as DocFactRow[]
}

// Parses a document_facts value_text ("-1.6%", "GH₵450,000", "18 units")
// into a plain number for comparison, stripping currency symbols/commas/unit
// words while keeping the leading sign and decimal point.
function parseDocFactNumber(valueText: string): number | null {
  const m = valueText.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : null
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

  // Resolution memory — only meaningful for a specific (entity_type, metric,
  // fiscal_year) triple, so only attempted when a fiscal_year was given and
  // at least one fact (clean or flagged) exists to derive entity_type from.
  // This is the system checking its OWN persistent memory before asking
  // Claude to re-derive a conflict it may have already resolved.
  let previousResolution
  if (input.fiscal_year && input.metric) {
    const sample = clean[0] ?? flagged[0]
    if (sample) {
      const resolution = await lookupResolution(ctx.svc, ctx.tenantId, {
        entity: input.entity, entityType: sample.entity_type, metric: input.metric, fiscalYear: input.fiscal_year,
      })
      if (resolution) {
        previousResolution = {
          resolved_value_millions: resolution.resolvedValueMillions, unit: resolution.unit,
          reasoning: resolution.reasoning, confidence: resolution.confidence, resolved_at: resolution.resolvedAt,
        }
      }
    }
  }

  // financial_facts has nothing at all for this entity — likely a non-budget
  // tenant (or a genuinely non-financial entity name). Fall back to the
  // generic document_facts store rather than leaving this tool permanently
  // useless for such tenants. See fetchValidatedDocFacts for why this matters.
  let docFacts: DocFactRow[] = []
  if (all.length === 0) {
    docFacts = await fetchValidatedDocFacts(ctx.svc, ctx.tenantId, input.entity)
  }

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
    document_facts: docFacts.length ? docFacts.map(f => ({
      subject: f.subject, attribute: f.attribute, value: f.unit ? `${f.value_text} ${f.unit}` : f.value_text,
      confidence: f.confidence, source_document_id: f.document_id, page: f.page_number,
    })) : undefined,
    previous_resolution: previousResolution,
    note: clean.length === 0 && docFacts.length === 0
      ? 'No validated figure found for this entity/metric/year in either the financial_facts or document_facts store. Do not guess — say so, or check flagged values below for context only (never state a flagged value as fact).'
      : clean.length === 0 && docFacts.length > 0
        ? 'No financial_facts figure for this entity, but matching rows were found in document_facts (see that field) — prefer those exact values over anything recalled from raw excerpt text.'
        : undefined,
  }
}

export async function executeRecordResolution(ctx: AgentToolContext, input: {
  entity: string; entity_type: string; metric: string; fiscal_year: string
  resolved_value_millions: number; unit?: string; resolution_pattern: ResolutionPattern
  reasoning: string; confidence: number
}) {
  await recordResolution(ctx.svc, ctx.tenantId, {
    entity: input.entity, entityType: input.entity_type, metric: input.metric, fiscalYear: input.fiscal_year,
    resolvedValueMillions: input.resolved_value_millions, unit: input.unit,
    resolutionPattern: input.resolution_pattern, reasoning: input.reasoning, confidence: input.confidence,
  })
  return { saved: true }
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
    // financial_facts has nothing for this entity at all — before giving up,
    // check the generic document_facts store (the only structured fact layer
    // for non-budget tenants). See fetchValidatedDocFacts for the confirmed
    // real-world case this closes: a model mis-pairing a chart's scattered
    // labels/values (e.g. stating "Ghana Stock Market 13.1%" when the
    // extracted fact was "-1.6%") with no tool available to catch it.
    const docFacts = await fetchValidatedDocFacts(ctx.svc, ctx.tenantId, input.entity)
    if (!docFacts.length) {
      return { supported: false, note: 'No validated facts at all for this entity/year — cannot confirm or deny this figure from structured data. Check document excerpts directly.' }
    }
    const parsed = docFacts.map(f => ({ f, n: parseDocFactNumber(f.value_text) })).filter((p): p is { f: DocFactRow; n: number } => p.n != null)
    const match = parsed.find(p => Math.abs(p.n - input.value) <= Math.max(Math.abs(p.n) * 0.02, 0.05))
    if (match) {
      return {
        supported: true, matched_value: match.f.unit ? `${match.f.value_text} ${match.f.unit}` : match.f.value_text,
        subject: match.f.subject, attribute: match.f.attribute, confidence: match.f.confidence,
      }
    }
    const distinctDoc = [...new Map(parsed.map(p => [p.f.subject, p])).values()]
    return {
      supported: false,
      closest_validated_values: distinctDoc.slice(0, 5).map(p => ({
        subject: p.f.subject, attribute: p.f.attribute, value: p.f.unit ? `${p.f.value_text} ${p.f.unit}` : p.f.value_text,
      })),
      note: 'This figure does not match any validated document_facts value for a matching subject — do not state it. If you were about to cite a different value than what is shown here, use the value shown here instead.',
    }
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
    case 'record_resolution': return executeRecordResolution(ctx, input as Parameters<typeof executeRecordResolution>[1])
    default: return { error: `Unknown tool: ${name}` }
  }
}

// canonicalizeEntity/dedupeFacts re-exported for callers that want the same
// entity-name normalization the tools use internally (e.g. agenticAnswer.ts
// formatting tool results for citations).
export { canonicalizeEntity, dedupeFacts }
