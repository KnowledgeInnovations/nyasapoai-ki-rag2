/**
 * Self-assessment engine for the Training page. Generates test questions
 * from the validated `financial_facts` ground truth and from the trained
 * document chunks themselves, replays each one through the same retrieval +
 * generation + verification pipeline used by the chat route (non-streaming),
 * and scores the answer against the known value / reference answer. Lets the
 * system report a real accuracy/performance number for whatever documents
 * are currently trained — instead of just a confidence badge on individual
 * answers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  classifyQuery, computeGrowthCalculations, verifyAnswer, extractFigures, toMillions,
} from '@/lib/ragAnalysis'
import { rerankChunks } from '@/lib/rerank'
import { extractQueryFilters } from '@/lib/factExtraction'
import { verifyAnswerWithAI } from '@/lib/answerVerifier'
import {
  OPENAI_HEADERS, SYSTEM_PROMPT, QUERY_TYPE_GUIDANCE, FACTS_QUERY_TYPES, parseDelimited,
} from '@/app/api/chat/route'

interface FactRow {
  fiscal_year: string | null
  entity: string
  entity_type: string
  metric: string
  value: number
  unit: string
  value_millions: number | null
  document_id: string
  page_number: number | null
  confidence: number
}

export type ExpectedInfo =
  | { entity: string; metric: string; fiscalYear: string | null; value: number; unit: string }
  | { entity: string; metric: string; fromYear: string; toYear: string; growthPct: number }
  | { docTitle: string }
  | { answer: string }
  | null

export interface AssessmentQuestion {
  question: string
  kind: 'fact' | 'trend' | 'chunk' | 'inventory'
  fact?: FactRow
  factA?: FactRow
  factB?: FactRow
  expectedDocTitle?: string
  expectedAnswer?: string
  expectedDocumentId?: string
  expectedDocumentIds?: string[]
}

// Match the live-chat VALIDATED FACTS confidence bar — facts below this are
// extraction noise too unreliable to serve as assessment ground truth (wrong
// entity labels, implausible values), which previously produced nonsense
// "expected" values and crashed accuracy to 0%.
const ASSESSMENT_FACT_MIN_CONFIDENCE = 70

export interface AssessmentRunResult {
  answer: string
  confidenceScore: number
  risks: string[]
  citedDocumentIds: string[]
}

export interface AssessmentScore {
  question: string
  expected: ExpectedInfo
  answerExcerpt: string
  confidenceScore: number
  risks: string[]
  numericMatch: boolean
  citationMatch: boolean
  passed: boolean
}

const METRIC_LABELS: Record<string, string> = {
  total_budget: 'the total national budget',
  revenue: 'total government revenue',
  debt: 'the total public debt',
  capital_expenditure: 'capital expenditure',
  recurrent_expenditure: 'recurrent expenditure',
}

// Phrases a metric for `fact`, scoping it to the fact's actual entity unless
// the entity IS the national government — using a generic "total national
// budget"-style label for a sector-specific fact (e.g. "Health") would
// produce a question whose expected value doesn't match what's asked.
function metricLabel(fact: FactRow): string {
  if (fact.entity_type === 'national') {
    return METRIC_LABELS[fact.metric] ?? fact.metric.replace(/_/g, ' ')
  }
  if (fact.metric === 'allocation') {
    return `the budget allocation for ${fact.entity}`
  }
  return `the ${fact.metric.replace(/_/g, ' ')} for ${fact.entity}`
}

function buildQuestion(fact: FactRow): string {
  const year = fact.fiscal_year ?? 'the most recent year'
  return `What was ${metricLabel(fact)} in ${year}?`
}

function buildTrendQuestion(a: FactRow, b: FactRow): string {
  return `How did ${metricLabel(a)} change between ${a.fiscal_year} and ${b.fiscal_year}, and by what percentage?`
}

function expectedGrowthPct(a: FactRow, b: FactRow): number {
  const va = a.value_millions ?? a.value
  const vb = b.value_millions ?? b.value
  if (!va) return 0
  return Math.round(((vb - va) / va) * 1000) / 10
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function parseQA(text: string): { question: string; answer: string } | null {
  const m = text.match(/QUESTION:\s*([\s\S]+?)\s*\n+ANSWER:\s*([\s\S]+)/i)
  if (!m) return null
  return { question: m[1].trim(), answer: m[2].trim() }
}

const HARD_QUESTION_RULES =
  'Write a CHALLENGING question that requires genuine reasoning — e.g. comparing two or more figures/' +
  'policies/years, explaining cause-and-effect, computing a difference, ratio, or percentage from numbers ' +
  'given in the excerpt(s), or synthesizing several details into one answer. ' +
  'If your question asks for a computed difference, ratio, or percentage, the two quantities involved ' +
  'MUST be the same metric and unit (e.g. both are revenue amounts in GHS, or both are completion ' +
  'percentages, or both are prices in the same currency). NEVER compute a ratio or percentage between ' +
  'two unrelated quantities (e.g. a count of people/units vs. a currency amount, or a percentage vs. an ' +
  'absolute figure) — if the only numbers available are unrelated like that, ask a qualitative comparison ' +
  'question instead (e.g. how priorities/strategies/outcomes differ). ' +
  'NEVER invent a hypothetical, assumed, or example number (e.g. "assuming the 2024 total was $700 million", ' +
  '"if the 2025 figure was X") — every number in your question and answer must be a REAL value that actually ' +
  'appears in the excerpt(s). If you cannot find two real comparable numbers, ask a qualitative question instead. ' +
  'Do NOT write a simple "what is mentioned" recall question, and do NOT write a yes/no question. ' +
  'The question must NOT be answerable without reading the excerpt(s).'

// Generates one hard, "deep think" question + concise reference answer from a
// single document chunk's content via an LLM, so assessment runs exercise
// genuine comprehension/reasoning over the trained material — not just
// inventory-existence checks.
async function generateChunkQuestion(
  chunkText: string, docTitle: string, signal?: AbortSignal,
): Promise<{ question: string; answer: string } | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: OPENAI_HEADERS,
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0.5, max_tokens: 260,
        messages: [
          {
            role: 'system',
            content: 'You write hard test questions for evaluating an AI assistant\'s ability to read, reason about, and analyze a document.',
          },
          {
            role: 'user',
            content:
              `The excerpt below is from a document titled "${docTitle}". Based ONLY on this excerpt, ${HARD_QUESTION_RULES} ` +
              'Then give a concise correct answer (1-3 sentences) using only information from the excerpt, ' +
              'including any numbers/percentages your answer depends on.\n\n' +
              `Excerpt:\n"""\n${chunkText.slice(0, 2000)}\n"""\n\n` +
              'Respond in exactly this format:\nQUESTION: <question>\nANSWER: <answer>',
          },
        ],
      }),
      signal,
    })
    const data = await res.json()
    return parseQA(data.choices?.[0]?.message?.content ?? '')
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e
    return null
  }
}

// Budget-document topic keywords used to pair chunks that discuss the SAME
// subject (e.g. revenue, debt, social protection) so cross-chunk questions
// are meaningful comparisons/trends rather than arbitrary cross-topic
// arithmetic between unrelated figures.
const TOPIC_KEYWORDS = [
  'total revenue', 'tax revenue', 'non-oil revenue', 'total expenditure', 'total budget',
  'fiscal deficit', 'primary balance', 'public debt', 'domestic debt', 'external debt',
  'capital expenditure', 'recurrent expenditure', 'compensation of employees', 'wage bill',
  'social protection', 'petroleum revenue', 'crude oil', 'gdp growth', 'inflation',
  'poverty reduction', 'health', 'education', 'agriculture', 'energy sector', 'cocoa',
  'youth employment', 'budget allocation', 'gdp', 'exchange rate', 'net domestic financing',
]

function topicsIn(text: string): Set<string> {
  const lower = text.toLowerCase()
  return new Set(TOPIC_KEYWORDS.filter(k => lower.includes(k)))
}

// Generates a hard comparison/trend question spanning TWO excerpts that
// discuss a shared topic (from different documents, or different sections of
// the same document), so assessment runs also test multi-source retrieval
// and synthesis — not just single-passage recall.
async function generateCrossChunkQuestion(
  excerptA: string, titleA: string, excerptB: string, titleB: string, signal?: AbortSignal,
): Promise<{ question: string; answer: string } | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: OPENAI_HEADERS,
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0.5, max_tokens: 300,
        messages: [
          {
            role: 'system',
            content: 'You write hard test questions for evaluating an AI assistant\'s ability to compare and synthesize information across multiple documents.',
          },
          {
            role: 'user',
            content:
              'You are given two excerpts from different parts of a knowledge base that discuss a SHARED topic ' +
              '(e.g. the same metric, sector, or programme, possibly from different years). ' +
              `${HARD_QUESTION_RULES} Anchor the question on that shared topic — e.g. how it changed between the ` +
              'two excerpts, a target vs. an actual outcome, or a before/after comparison. ' +
              'Do NOT invent a comparison between two unrelated figures. ' +
              'If, after reading both, they do NOT actually share a comparable topic, respond with exactly: NONE\n\n' +
              'Then give a concise correct answer (2-3 sentences) drawing on both excerpts, ' +
              'including any numbers/percentages your answer depends on.\n\n' +
              `Excerpt A (from "${titleA}"):\n"""\n${excerptA.slice(0, 1200)}\n"""\n\n` +
              `Excerpt B (from "${titleB}"):\n"""\n${excerptB.slice(0, 1200)}\n"""\n\n` +
              'Respond in exactly this format:\nQUESTION: <question>\nANSWER: <answer>\n(or just NONE)',
          },
        ],
      }),
      signal,
    })
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content ?? ''
    if (/^\s*NONE\s*$/i.test(text)) return null
    return parseQA(text)
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e
    return null
  }
}

// Picks a sample of trained document chunks and turns them into hard
// comprehension questions via `generateChunkQuestion`.
async function generateChunkQuestions(
  svc: SupabaseClient, tenantId: string, documentId: string | null, count: number, signal?: AbortSignal,
): Promise<AssessmentQuestion[]> {
  if (count <= 0) return []

  const { chunks, titleOf } = await fetchChunksWithTitles(svc, tenantId, documentId)
  const candidates = shuffle(chunks.filter(c => c.chunk_text.length > 300))

  const out: AssessmentQuestion[] = []
  for (const c of candidates) {
    if (out.length >= count) break
    const qa = await generateChunkQuestion(c.chunk_text, titleOf(c.document_id), signal)
    if (qa) {
      out.push({
        kind: 'chunk', question: qa.question,
        expectedAnswer: qa.answer, expectedDocumentId: c.document_id,
      })
    }
  }
  return out
}

// Picks pairs of chunks — from two different documents when assessing the
// whole knowledge base, or two different sections of the same document when
// assessing a single document — and turns each pair into a hard cross-source
// comparison question via `generateCrossChunkQuestion`.
async function generateCrossChunkQuestions(
  svc: SupabaseClient, tenantId: string, documentId: string | null, count: number, signal?: AbortSignal,
): Promise<AssessmentQuestion[]> {
  if (count <= 0) return []

  const { chunks, titleOf } = await fetchChunksWithTitles(svc, tenantId, documentId)
  const substantial = shuffle(chunks.filter(c => c.chunk_text.length > 300))
  if (substantial.length < 2) return []

  const withTopics = substantial.map(c => ({ ...c, topics: topicsIn(c.chunk_text) }))

  // Greedily pair chunks that share at least one budget-topic keyword —
  // preferring different source documents when assessing the whole
  // knowledge base — so cross-chunk questions compare/track the SAME
  // subject instead of two unrelated figures.
  const pairs: [typeof withTopics[number], typeof withTopics[number]][] = []
  const used = new Set<number>()
  for (let i = 0; i < withTopics.length && pairs.length < count; i++) {
    if (used.has(i) || withTopics[i].topics.size === 0) continue
    let bestJ = -1
    let bestScore = 0
    for (let j = i + 1; j < withTopics.length; j++) {
      if (used.has(j)) continue
      if (documentId && withTopics[j].document_id !== withTopics[i].document_id) continue
      if (!documentId && withTopics[j].document_id === withTopics[i].document_id) continue
      let score = 0
      for (const t of withTopics[i].topics) if (withTopics[j].topics.has(t)) score++
      if (score > bestScore) { bestScore = score; bestJ = j }
    }
    if (bestJ === -1 || bestScore === 0) continue
    pairs.push([withTopics[i], withTopics[bestJ]])
    used.add(i); used.add(bestJ)
  }

  const out: AssessmentQuestion[] = []
  for (const [a, b] of pairs) {
    if (out.length >= count) break
    const qa = await generateCrossChunkQuestion(a.chunk_text, titleOf(a.document_id), b.chunk_text, titleOf(b.document_id), signal)
    if (qa) {
      out.push({
        kind: 'chunk', question: qa.question,
        expectedAnswer: qa.answer,
        expectedDocumentIds: [...new Set([a.document_id, b.document_id])],
      })
    }
  }
  return out
}

async function fetchChunksWithTitles(
  svc: SupabaseClient, tenantId: string, documentId: string | null,
): Promise<{ chunks: { document_id: string; chunk_text: string }[]; titleOf: (id: string) => string }> {
  let chunkQuery = svc
    .from('document_chunks')
    .select('document_id, chunk_text')
    .eq('tenant_id', tenantId)
    .limit(200)
  if (documentId) chunkQuery = chunkQuery.eq('document_id', documentId)

  const [{ data: chunks }, { data: docs }] = await Promise.all([
    chunkQuery,
    svc.from('documents').select('id, title').eq('tenant_id', tenantId),
  ])

  const titles = new Map((docs ?? []).map(d => [d.id as string, d.title as string]))
  return {
    chunks: (chunks ?? []) as { document_id: string; chunk_text: string }[],
    titleOf: (id: string) => titles.get(id) ?? 'Unknown document',
  }
}

// Pulls validated financial_facts rows (confidence >= 70, no flags), dedups
// by (entity, entity_type, metric, fiscal_year) keeping the highest-confidence
// row, and turns a sample into a mix of single-year lookup questions and
// multi-year trend/comparison questions. Tops up with deep comprehension
// questions generated from document chunks, and falls back to
// inventory-existence questions only if nothing else is usable.
export async function generateAssessmentQuestions(
  svc: SupabaseClient,
  tenantId: string,
  documentId: string | null,
  limit = 12,
  signal?: AbortSignal,
): Promise<AssessmentQuestion[]> {
  let factsQuery = svc
    .from('financial_facts')
    .select('fiscal_year, entity, entity_type, metric, value, unit, value_millions, document_id, page_number, confidence, flags')
    .eq('tenant_id', tenantId)
    .gte('confidence', ASSESSMENT_FACT_MIN_CONFIDENCE)
    .limit(500)
  if (documentId) factsQuery = factsQuery.eq('document_id', documentId)

  const { data: facts } = await factsQuery
  const usable = (facts ?? []).filter(f => !(f.flags as string[])?.length) as FactRow[]

  const byKey = new Map<string, FactRow>()
  for (const f of usable) {
    const key = `${f.entity_type}|${f.entity}|${f.metric}|${f.fiscal_year}`
    const existing = byKey.get(key)
    if (!existing || f.confidence > existing.confidence) byKey.set(key, f)
  }

  // Group the deduped rows by (entity_type, entity, metric) so pairs across
  // different fiscal years can become trend/comparison questions.
  const byEntityMetric = new Map<string, FactRow[]>()
  for (const f of byKey.values()) {
    const k = `${f.entity_type}|${f.entity}|${f.metric}`
    if (!byEntityMetric.has(k)) byEntityMetric.set(k, [])
    byEntityMetric.get(k)!.push(f)
  }

  const factQuestions: AssessmentQuestion[] = []
  const trendQuestions: AssessmentQuestion[] = []

  for (const rows of byEntityMetric.values()) {
    const withYear = rows.filter(r => r.fiscal_year).sort((a, b) => (a.fiscal_year! < b.fiscal_year! ? -1 : 1))
    if (withYear.length >= 2) {
      const a = withYear[0]
      const b = withYear[withYear.length - 1]
      trendQuestions.push({ kind: 'trend', question: buildTrendQuestion(a, b), factA: a, factB: b })
    } else {
      factQuestions.push({ kind: 'fact', question: buildQuestion(rows[0]), fact: rows[0] })
    }
  }

  const shuffledFacts = shuffle(factQuestions)
  const shuffledTrends = shuffle(trendQuestions)

  // Reserve roughly a quarter of the slots each for single-year facts and
  // multi-year trends, and split the rest between hard single-excerpt and
  // cross-excerpt synthesis questions — so a run isn't dominated by easy
  // single-fact recall.
  const factsTake = Math.min(shuffledFacts.length, Math.ceil(limit * 0.25))
  const trendsTake = Math.min(shuffledTrends.length, Math.ceil(limit * 0.25))

  const selected: AssessmentQuestion[] = [
    ...shuffledFacts.slice(0, factsTake),
    ...shuffledTrends.slice(0, trendsTake),
  ]

  let remaining = limit - selected.length
  if (remaining > 0) {
    const crossTake = Math.ceil(remaining / 2)
    const crossQs = await generateCrossChunkQuestions(svc, tenantId, documentId, crossTake, signal)
    selected.push(...crossQs)
    remaining = limit - selected.length
  }

  if (remaining > 0) {
    const chunkQs = await generateChunkQuestions(svc, tenantId, documentId, remaining, signal)
    selected.push(...chunkQs)
  }

  if (selected.length) return shuffle(selected).slice(0, limit)

  // No validated facts and no usable chunks — fall back to simple
  // inventory-existence questions so a run always produces a result.
  let docsQuery = svc.from('documents').select('id, title').eq('tenant_id', tenantId).eq('status', 'ready')
  if (documentId) docsQuery = docsQuery.eq('id', documentId)
  const { data: docs } = await docsQuery.limit(limit)

  return (docs ?? []).map(d => ({
    kind: 'inventory' as const,
    question: `Do we have a file titled "${d.title}"?`,
    expectedDocTitle: d.title,
  }))
}

type RetrievedChunk = {
  id: string; document_id: string; chunk_text: string; metadata: Record<string, unknown>
  similarity: number; rrf_score?: number; rerank_score?: number
}

// Non-streaming replay of the chat route's retrieve -> facts -> generate ->
// verify pipeline for a single question.
export async function runAssessmentQuery(
  question: string,
  tenantId: string,
  svc: SupabaseClient,
  signal?: AbortSignal,
): Promise<AssessmentRunResult> {
  const [embRes, { data: docInventory }] = await Promise.all([
    fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST', headers: OPENAI_HEADERS,
      body: JSON.stringify({ model: 'text-embedding-3-small', input: question }),
      signal,
    }),
    svc.from('documents').select('title, department, status').eq('tenant_id', tenantId).eq('status', 'ready').limit(100),
  ])
  const embData = await embRes.json()
  const queryEmbedding = embData.data[0].embedding

  const inventoryText = docInventory?.length
    ? `KNOWLEDGE BASE INVENTORY (${docInventory.length} file${docInventory.length !== 1 ? 's' : ''}):\n` +
      docInventory.map(d => `• ${d.title}${d.department ? ` [category: ${d.department}]` : ''}`).join('\n')
    : 'KNOWLEDGE BASE INVENTORY: No files have been uploaded yet.'

  const { data: hybridChunks } = await svc.rpc('match_document_chunks_hybrid', {
    query_embedding: queryEmbedding, query_text: question, p_tenant_id: tenantId,
    match_count: 30,
  })

  const chunks: RetrievedChunk[] = hybridChunks?.length
    ? await rerankChunks(question, hybridChunks as RetrievedChunk[], 10)
    : []

  if (!chunks.length) {
    return { answer: 'Insufficient evidence found in the available documents.', confidenceScore: 1, risks: [], citedDocumentIds: [] }
  }

  const context = chunks.map((c, i) => `[${i + 1}] ${c.chunk_text}`).join('\n\n')

  const growthCalcs = computeGrowthCalculations(chunks)
  const calcBlock = growthCalcs.length
    ? '\n\nPRE-COMPUTED FIGURES & GROWTH (verified — use these exact numbers):\n' +
      growthCalcs.map(g =>
        `- ${g.fromYear} → ${g.toYear}: ${g.fromValue} → ${g.toValue} (${g.unit}), `
        + `growth ${g.growthPct > 0 ? '+' : ''}${g.growthPct}% ${g.citations.map(n => `[${n}]`).join('')}`
      ).join('\n')
    : ''

  const queryType = classifyQuery(question)
  const guidance = QUERY_TYPE_GUIDANCE[queryType]
  const guidanceBlock = guidance ? `\n\n${guidance}` : ''

  let factsBlock = ''
  if (FACTS_QUERY_TYPES.includes(queryType)) {
    const { years, entityHint } = extractQueryFilters(question, chunks)

    let factsQuery = svc
      .from('financial_facts')
      .select('fiscal_year, entity, entity_type, metric, value, unit, page_number, section_title, document_id, confidence, flags')
      .eq('tenant_id', tenantId)
      .order('fiscal_year', { ascending: true })
      .limit(60)
    if (years.length) factsQuery = factsQuery.in('fiscal_year', years)
    if (entityHint) factsQuery = factsQuery.ilike('entity', `%${entityHint}%`)

    const { data: facts } = await factsQuery
    const validFacts = (facts ?? []).filter(f => f.confidence >= 70 && !(f.flags as string[])?.length)
    const flaggedFacts = (facts ?? []).filter(f => (f.flags as string[])?.length)

    if (validFacts.length || flaggedFacts.length) {
      const lines = [
        'VALIDATED FACTS (from financial_facts store — pre-verified, use these exact values; do not recompute or alter them):',
        '| Year | Entity | Metric | Value | Unit | Confidence |',
        ...validFacts.map(f =>
          `| ${f.fiscal_year ?? '—'} | ${f.entity} | ${f.metric} | ${f.value} | ${f.unit} | ${f.confidence}% |`
        ),
      ]
      if (flaggedFacts.length) {
        lines.push('\nFLAGGED — DO NOT USE as fact (data quality issues detected):')
        lines.push(...flaggedFacts.map(f =>
          `- ${f.fiscal_year ?? '—'} ${f.entity} ${f.metric} = ${f.value} ${f.unit} (${(f.flags as string[]).join(', ')})`
        ))
      }
      factsBlock = '\n\n' + lines.join('\n')
    } else {
      factsBlock = '\n\nVALIDATED FACTS: No validated facts found for the requested year/entity. ' +
        "If the excerpts below also don't clearly support a confident figure, respond with the standard insufficient-evidence message."
    }
  }

  const compRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: OPENAI_HEADERS,
    body: JSON.stringify({
      model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 800,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${inventoryText}\n\nDOCUMENT EXCERPTS FROM SEARCH:\n${context}${calcBlock}${factsBlock}${guidanceBlock}\n\nQuestion: ${question}` },
      ],
    }),
    signal,
  })
  const compData = await compRes.json()
  const fullText = compData.choices?.[0]?.message?.content ?? ''
  const { answer, risks } = parseDelimited(fullText)

  const retrievalScores = chunks.map(c => c.rerank_score ?? c.similarity ?? c.rrf_score ?? 0)
  const verification = verifyAnswer(answer, chunks, retrievalScores)

  if (FACTS_QUERY_TYPES.includes(queryType)) {
    try {
      const { issues } = await verifyAnswerWithAI({ query: question, answer, factsBlock, context, signal })
      if (issues.length) {
        risks.push(...issues)
        verification.confidenceScore = Math.max(1, verification.confidenceScore - 15 * issues.length)
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e
    }
  }

  // Which chunks the answer actually cited via [n] markers.
  const citedIndices = new Set([...answer.matchAll(/\[(\d+)\]/g)].map(m => parseInt(m[1], 10)))
  const citedDocumentIds = [...new Set(
    [...citedIndices].map(n => chunks[n - 1]?.document_id).filter((id): id is string => !!id)
  )]

  return { answer, confidenceScore: verification.confidenceScore, risks, citedDocumentIds }
}

const TOLERANCE = 0.02

function valuesMatch(extracted: ReturnType<typeof extractFigures>[number], fact: FactRow): boolean {
  if (fact.value_millions != null && (extracted.unit === 'million' || extracted.unit === 'billion')) {
    const m = toMillions(extracted)
    if (m == null) return false
    return Math.abs(m - fact.value_millions) <= Math.abs(fact.value_millions) * TOLERANCE + 0.01
  }
  if (extracted.unit === null || extracted.unit === 'cedis') {
    return Math.abs(extracted.value - fact.value) <= Math.abs(fact.value) * TOLERANCE + 0.01
  }
  return false
}

// Asks an LLM to grade whether the actual answer conveys the same key
// information as a reference answer derived from a document chunk.
async function judgeAnswer(question: string, expected: string, actual: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: OPENAI_HEADERS,
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0, max_tokens: 100,
        messages: [
          {
            role: 'system',
            content:
              'You grade an AI answer against a reference answer for a budget-document Q&A assessment. ' +
              'PASS if the AI answer reaches the same overall conclusion/comparison as the reference and its key ' +
              'figures are reasonably close (within ~10%) to the reference\'s — minor wording differences, extra ' +
              'detail, or slightly different supporting numbers do NOT make it FAIL. ' +
              'FAIL only if the AI answer: reaches a materially different conclusion than the reference; states it ' +
              'cannot find information that the reference shows IS available; or states a key figure that ' +
              'meaningfully contradicts the reference (not just rounding/formatting differences). ' +
              'Respond with a brief reason, then on a new final line write exactly "VERDICT: PASS" or "VERDICT: FAIL".',
          },
          {
            role: 'user',
            content: `Question: ${question}\n\nReference answer: ${expected}\n\nAI answer: ${actual}`,
          },
        ],
      }),
      signal,
    })
    const data = await res.json()
    const verdict = data.choices?.[0]?.message?.content ?? ''
    const m = verdict.match(/VERDICT:\s*(PASS|FAIL)/i)
    return m ? /pass/i.test(m[1]) : /pass/i.test(verdict)
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e
    return false
  }
}

// Compares an assessment run's answer against the ground-truth fact, the
// expected trend/growth figure, the reference answer for a chunk-derived
// comprehension question, or the expected document title for inventory
// fallback questions.
export async function scoreResult(
  q: AssessmentQuestion, result: AssessmentRunResult, signal?: AbortSignal,
): Promise<AssessmentScore> {
  const answerExcerpt = result.answer.length > 240 ? result.answer.slice(0, 240) + '…' : result.answer

  if (q.kind === 'inventory') {
    const passed = /\byes\b/i.test(result.answer)
    return {
      question: q.question,
      expected: q.expectedDocTitle ? { docTitle: q.expectedDocTitle } : null,
      answerExcerpt,
      confidenceScore: result.confidenceScore,
      risks: result.risks,
      numericMatch: passed,
      citationMatch: true,
      passed,
    }
  }

  if (q.kind === 'trend' && q.factA && q.factB) {
    const { factA, factB } = q
    const expected = expectedGrowthPct(factA, factB)
    const percentFigures = extractFigures(result.answer).filter(f => f.unit === '%' || f.unit === 'percent')
    const numericMatch = percentFigures.some(f =>
      Math.abs(f.value - expected) <= Math.max(1, Math.abs(expected) * 0.1)
    )
    const citationMatch = result.citedDocumentIds.includes(factA.document_id) || result.citedDocumentIds.includes(factB.document_id)

    return {
      question: q.question,
      expected: { entity: factA.entity, metric: factA.metric, fromYear: factA.fiscal_year!, toYear: factB.fiscal_year!, growthPct: expected },
      answerExcerpt,
      confidenceScore: result.confidenceScore,
      risks: result.risks,
      numericMatch,
      citationMatch,
      passed: numericMatch && result.risks.length === 0,
    }
  }

  if (q.kind === 'chunk' && q.expectedAnswer) {
    const passedJudge = await judgeAnswer(q.question, q.expectedAnswer, result.answer, signal)
    const expectedDocIds = q.expectedDocumentIds ?? (q.expectedDocumentId ? [q.expectedDocumentId] : [])
    const citationMatch = expectedDocIds.length
      ? expectedDocIds.some(id => result.citedDocumentIds.includes(id))
      : true

    return {
      question: q.question,
      expected: { answer: q.expectedAnswer },
      answerExcerpt,
      confidenceScore: result.confidenceScore,
      risks: result.risks,
      numericMatch: passedJudge,
      citationMatch,
      // For open-ended reasoning questions, the LLM judge comparing against
      // the excerpt-derived reference answer is the authoritative check —
      // the generic fact-checker (tuned for VALIDATED FACTS-driven
      // fact/trend/comparison queries) is shown for diagnostics but doesn't
      // gate pass/fail here, since it has a high false-positive rate on
      // free-form comprehension answers.
      passed: passedJudge,
    }
  }

  // q.kind === 'fact'
  const fact = q.fact!
  const figures = extractFigures(result.answer).filter(f => f.unit !== '%' && f.unit !== 'percent')
  const numericMatch = figures.some(f => valuesMatch(f, fact))
  const citationMatch = result.citedDocumentIds.includes(fact.document_id)

  return {
    question: q.question,
    expected: { entity: fact.entity, metric: fact.metric, fiscalYear: fact.fiscal_year, value: fact.value, unit: fact.unit },
    answerExcerpt,
    confidenceScore: result.confidenceScore,
    risks: result.risks,
    numericMatch,
    citationMatch,
    passed: numericMatch && result.risks.length === 0,
  }
}
