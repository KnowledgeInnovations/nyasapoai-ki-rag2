import { NextRequest, NextResponse } from 'next/server'
import { getMembership, getUser } from '@/lib/supabase/server'
import { canAccessTraining } from '@/lib/roles'
import { getServiceClient, OPENAI_HEADERS } from '@/app/api/chat/route'
import { extractQueryFilters } from '@/lib/factExtraction'

export const maxDuration = 120

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'was', 'were', 'are', 'be', 'been', 'of', 'in', 'on',
  'at', 'to', 'for', 'and', 'or', 'what', 'which', 'who', 'whom', 'how', 'why',
  'when', 'where', 'much', 'many', 'did', 'does', 'do', 'this', 'that', 'these',
  'those', 'it', 'its', 'as', 'by', 'with', 'from', 'has', 'have', 'had', 'will',
  'would', 'can', 'could', 'about', 'than', 'over', 'under', 'per', 'into',
  'tell', 'me', 'show', 'give', 'please', 'all', 'any', 'total', 'amount',
  'each', 'year', 'years', 'every', 'were',
])

function extractKeywords(question: string): string[] {
  const words = question.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? []
  const keywords = new Set<string>()
  for (const w of words) {
    if (/^\d{4}$/.test(w)) { keywords.add(w); continue }
    if (w.length < 3 || STOPWORDS.has(w)) continue
    keywords.add(w)
  }
  return [...keywords]
}

const PAGE_SIZE = 1000

async function fetchAllChunks(
  svc: ReturnType<typeof getServiceClient>,
  tenantId: string,
  documentId: string,
) {
  const all: { chunk_text: string; page_number: number | null; section_title: string | null }[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page } = await svc
      .from('document_chunks')
      .select('chunk_text, page_number, section_title')
      .eq('tenant_id', tenantId)
      .eq('document_id', documentId)
      .order('page_number', { ascending: true, nullsFirst: true })
      .range(from, from + PAGE_SIZE - 1)
    if (!page?.length) break
    all.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return all
}

interface ResultDoc {
  documentId: string
  title:      string
  source:     string
  excerpts:   { pageNumber: number | null; sectionTitle: string | null; text: string }[]
}

export async function POST(request: NextRequest) {
  const membership = await getMembership()
  if (!membership || !canAccessTraining(membership.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { question, documentId = null } = await request.json().catch(() => ({}))
  if (!question || typeof question !== 'string' || !question.trim()) {
    return NextResponse.json({ error: 'A question is required.' }, { status: 400 })
  }

  const svc = getServiceClient()
  const tenantId = membership.tenant_id
  const keywords = extractKeywords(question)

  // Direct answers — looked up from `financial_facts`, the structured data
  // extracted directly from each document's tables at training time (not
  // AI-generated). Only VALIDATED facts (confidence >= 70, no flags) qualify.
  const facts = await lookupFacts(svc, tenantId, question, documentId)

  let results: ResultDoc[] = []

  if (keywords.length) {
    // Step 1: identify relevant documents.
    let documentIds: string[]
    if (documentId) {
      documentIds = [documentId]
    } else {
      // Use the most specific (longest) keywords for the lookup query, to keep
      // the OR filter bounded — the per-chunk scan below still checks every keyword.
      const searchKeywords = [...keywords].sort((a, b) => b.length - a.length).slice(0, 8)

      const chunkOr = searchKeywords.map(k => `chunk_text.ilike.%${k}%`).join(',')
      const { data: chunkMatches } = await svc
        .from('document_chunks')
        .select('document_id')
        .eq('tenant_id', tenantId)
        .or(chunkOr)
        .limit(5000)

      const titleOr = searchKeywords.map(k => `title.ilike.%${k}%`).join(',')
      const { data: titleMatches } = await svc
        .from('documents')
        .select('id')
        .eq('tenant_id', tenantId)
        .or(titleOr)

      const freq = new Map<string, number>()
      for (const r of chunkMatches ?? []) freq.set(r.document_id, (freq.get(r.document_id) ?? 0) + 1)
      const titleIds = new Set((titleMatches ?? []).map(r => r.id))

      documentIds = [...new Set([...freq.keys(), ...titleIds])]
        .sort((a, b) => {
          const diff = (freq.get(b) ?? 0) - (freq.get(a) ?? 0)
          if (diff !== 0) return diff
          return (titleIds.has(b) ? 1 : 0) - (titleIds.has(a) ? 1 : 0)
        })
        .slice(0, 10)
    }

    if (documentIds.length) {
      const { data: docRows } = await svc
        .from('documents')
        .select('id, title, source')
        .eq('tenant_id', tenantId)
        .in('id', documentIds)

      const docMeta = new Map((docRows ?? []).map(d => [d.id, { title: d.title, source: d.source }]))

      // Step 2: scan every chunk of every relevant document for verbatim matches.
      for (const docId of documentIds) {
        const meta = docMeta.get(docId)
        if (!meta) continue

        const chunks = await fetchAllChunks(svc, tenantId, docId)
        const excerpts: { pageNumber: number | null; sectionTitle: string | null; text: string }[] = []

        for (const c of chunks) {
          const text = (c.chunk_text ?? '').trim()
          if (!text) continue
          const lower = text.toLowerCase()
          if (keywords.some(k => lower.includes(k))) {
            excerpts.push({ pageNumber: c.page_number ?? null, sectionTitle: c.section_title ?? null, text })
          }
        }

        if (excerpts.length) {
          results.push({ documentId: docId, title: meta.title, source: meta.source, excerpts })
        }
      }
    }
  }

  // AI review — grades whether the Direct Answer facts + verbatim excerpts
  // above correctly and completely answer the question. This does NOT
  // generate the answer itself; it only judges the evidence already shown
  // to the user, and the verdict is recorded automatically as the
  // performance metric on the Training page.
  const review = await reviewSearchResult(question, facts, results)
  if (review) {
    const user = await getUser()
    const { error: reviewInsertError } = await svc.from('search_reviews').insert({
      tenant_id: tenantId,
      reviewed_by: user?.id ?? null,
      document_id: documentId,
      question: question.trim(),
      verdict: review.verdict,
      reasoning: review.reasoning,
      reviewer: 'ai',
    })
    if (reviewInsertError) console.error('[Training] Failed to record search review:', reviewInsertError)
  }

  return NextResponse.json({ question, keywords, facts, documents: results, review })
}

interface ReviewResult {
  verdict:   'correct' | 'incorrect'
  reasoning: string
}

const REVIEW_SYSTEM_PROMPT = `You are a QA reviewer for a financial knowledge-base search tool. You will be given a QUESTION typed by a user, a DIRECT ANSWER table of facts extracted directly from validated source document tables, and VERBATIM EXCERPTS retrieved from source documents.

Decide whether this evidence correctly and COMPLETELY answers the question:
- "correct" — the DIRECT ANSWER and/or EXCERPTS together directly and sufficiently answer the question.
- "incorrect" — the evidence is missing, irrelevant, contradictory, or only partially addresses the question (e.g. the question asks for a range of years but only some years are present).

Respond ONLY with JSON: {"verdict": "correct" | "incorrect", "reasoning": "short explanation, under 25 words"}.`

// Automatically grades the manual search results (Direct Answer + verbatim
// excerpts) against the question — the AI's role here is purely to verify
// the evidence already shown, not to generate or rewrite the answer.
async function reviewSearchResult(
  question: string,
  facts: DirectFact[],
  documents: ResultDoc[],
): Promise<ReviewResult | null> {
  const factsBlock = facts.length
    ? facts.map(f =>
        `- FY${f.fiscalYear ?? '?'}: ${f.entity} ${f.metric.replace(/_/g, ' ')} = ${f.value.toLocaleString()} ${f.unit} (source: ${f.documentTitle}${f.pageNumber != null ? `, p.${f.pageNumber}` : ''})`,
      ).join('\n')
    : '(none)'

  const excerptsBlock = documents.length
    ? documents.slice(0, 3).map(d =>
        d.excerpts.slice(0, 4).map(ex =>
          `[${d.title}${ex.pageNumber != null ? `, p.${ex.pageNumber}` : ''}]: ${ex.text.slice(0, 600)}`,
        ).join('\n'),
      ).join('\n')
    : '(none)'

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: OPENAI_HEADERS,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 150,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: REVIEW_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `QUESTION:\n${question}\n\nDIRECT ANSWER:\n${factsBlock}\n\nVERBATIM EXCERPTS:\n${excerptsBlock}`,
          },
        ],
      }),
    })
    if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const raw = data.choices?.[0]?.message?.content ?? ''
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (parsed.verdict !== 'correct' && parsed.verdict !== 'incorrect') return null
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 300) : ''
    return { verdict: parsed.verdict, reasoning }
  } catch (e) {
    console.error('[Training] AI search review failed:', e)
    return null
  }
}

interface DirectFact {
  fiscalYear:    string | null
  entity:        string
  entityType:    string
  metric:        string
  value:         number
  unit:          string
  documentId:    string
  documentTitle: string
  pageNumber:    number | null
  sectionTitle:  string | null
}

// Looks up VALIDATED rows from `financial_facts` matching the years/entity
// implied by the question — these are figures already extracted from the
// source document's tables, with a page citation, so showing them is
// equivalent to "stating the answer directly from the document source"
// without any AI synthesis.
async function lookupFacts(
  svc: ReturnType<typeof getServiceClient>,
  tenantId: string,
  question: string,
  documentId: string | null,
): Promise<DirectFact[]> {
  const { years, entityHint } = extractQueryFilters(question, [])
  if (!years.length && !entityHint) return []

  let factQuery = svc
    .from('financial_facts')
    .select('fiscal_year, entity, entity_type, metric, value, unit, value_millions, page_number, section_title, document_id, confidence, flags')
    .eq('tenant_id', tenantId)
    .gte('confidence', 70)

  if (years.length) factQuery = factQuery.in('fiscal_year', years)
  if (documentId) factQuery = factQuery.eq('document_id', documentId)

  if (entityHint === 'National') {
    factQuery = factQuery.eq('entity_type', 'national').in('metric', ['total_budget', 'allocation'])
  } else if (entityHint) {
    factQuery = factQuery.ilike('entity', `%${entityHint}%`)
  }

  const { data: rows } = await factQuery.limit(2000)
  const validated = (rows ?? []).filter(f => !(f.flags as unknown[] | null)?.length)
  if (!validated.length) return []

  // Dedupe by (entity, metric, fiscal_year) — prefer total_budget over
  // allocation for national queries, then highest confidence.
  const best = new Map<string, typeof validated[number]>()
  for (const f of validated) {
    const key = `${f.entity_type}|${f.entity}|${f.fiscal_year}`
    const cur = best.get(key)
    if (!cur) { best.set(key, f); continue }
    const fScore = f.metric === 'total_budget' ? 1 : 0
    const curScore = cur.metric === 'total_budget' ? 1 : 0
    if (fScore > curScore || (fScore === curScore && f.confidence > cur.confidence)) {
      best.set(key, f)
    }
  }

  const factRows = [...best.values()]
  const docIds = [...new Set(factRows.map(f => f.document_id).filter(Boolean))] as string[]
  const { data: docRows } = docIds.length
    ? await svc.from('documents').select('id, title').in('id', docIds)
    : { data: [] as { id: string; title: string }[] }
  const titleMap = new Map((docRows ?? []).map(d => [d.id, d.title]))

  return factRows
    .map(f => ({
      fiscalYear:    f.fiscal_year,
      entity:        f.entity,
      entityType:    f.entity_type,
      metric:        f.metric,
      value:         f.value_millions != null ? f.value_millions : f.value,
      unit:          f.value_millions != null ? 'GH¢ million' : f.unit,
      documentId:    f.document_id,
      documentTitle: titleMap.get(f.document_id) ?? 'Unknown document',
      pageNumber:    f.page_number,
      sectionTitle:  f.section_title,
    }))
    .sort((a, b) => (a.fiscalYear ?? '').localeCompare(b.fiscalYear ?? ''))
}
