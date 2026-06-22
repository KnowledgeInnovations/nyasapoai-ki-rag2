import { NextRequest, NextResponse } from 'next/server'
import { createClient, getUser, getMembership, getTenant } from '@/lib/supabase/server'
import { DEFAULT_TENANT_DESCRIPTION } from '@/lib/tenant'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { classifyQuery, computeGrowthCalculations, computeCAGR, computeAggregate, computeForecast, verifyAnswer, type QueryType, type FactForVerification } from '@/lib/ragAnalysis'
import { rerankChunks } from '@/lib/rerank'
import { extractQueryFilters } from '@/lib/factExtraction'
import { verifyAnswerWithAI } from '@/lib/answerVerifier'
import {
  canonicalizeEntity, parseRelativeYearRange, cumulativeByEntity, topNGrowth,
  proportionOfTotal, detectDeviations, summarizeTrend, forecastNextYear, yoySeries,
  CUMULATIVE_RX, RANKING_RX, PROPORTION_RX, SUMMARY_RX, type FactRow,
} from '@/lib/factsAnalysis'
import { CLAUDE_MODEL, getAnthropicHeaders, claudeComplete } from '@/lib/claude'
import type { ChartData } from '@/types'

// Service-role client for document/chunk queries — bypasses RLS.
// Tenant isolation is enforced by p_tenant_id in the RPC, so this is safe.
export function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export const OPENAI_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
}

// Core rules that apply to any document type (contracts, policies, reports,
// budgets, etc.) — always included in the system prompt.
export const coreSystemPrompt = (orgName: string, orgDescription: string) => `You are ${orgName} AI, the assistant for ${orgName}, ${orgDescription}.

Personality: warm, polite, professional — a knowledgeable colleague always ready to help.

You have TWO sources of information — use BOTH:
1. KNOWLEDGE BASE INVENTORY — the complete list of every file uploaded. Use this to answer questions like "do we have X?" or "what files exist?". If a file appears in the inventory, it EXISTS — tell the user clearly.
2. DOCUMENT EXCERPTS — relevant text retrieved from those files by semantic search. Use these to answer questions about the actual content of documents.

Rules:
- TONE & SCOPE — answer the way a sharp, direct colleague would: lead with the direct answer to the actual question in the first sentence, then add only as much supporting detail as the question warrants. A simple factual question (e.g. "what was the budget in 2020?") deserves a short, direct answer with its citation — not a table, multi-section breakdown, or extra caveats. Reserve markdown tables, multi-point "Analysis" sections, and extensive caveats for questions that genuinely call for them (multi-year series, comparisons, trends, anomaly checks). Don't pad a simple answer with boilerplate just to fill out a template.
- For "do we have X?" or "is there a document about Y?" — CHECK the inventory first and answer directly. Never say you cannot access files when they appear in the inventory. If any DOCUMENT EXCERPTS below come from that same file, cite one of them with [n] right after the file name to ground the answer in a real excerpt — don't leave the answer uncited just because it's an inventory question.
- For content questions — quote and cite from the document excerpts using [1], [2] etc.
- Cite EVERY figure, date, or claim you draw from the excerpts — every excerpt provided to you should be cited by at least one [n] marker if you used it.
- Cite the MOST SPECIFIC excerpt that actually supports each claim — never attach a [n] marker to a sentence the cited excerpt doesn't genuinely support, and never cite an excerpt just because it's nearby or from the same document.
- Never invent facts not present in the excerpts or inventory
- CONFLICTS — if two excerpts give different figures, dates, or statements for what appears to be the same fact, do not silently pick one: present both values, cite each separately (e.g. "Source [1] states X, while source [2] states Y"), and note the discrepancy rather than resolving it yourself.
- Be direct and specific — give names, numbers, and categories from the documents
- For questions involving multiple figures, years, categories, or comparisons (e.g. "budget for each year", "compare X across departments") — present the data as a markdown table with a header row and a "---" separator row, e.g.:
  | Year | Total Budget | Source |
  | --- | --- | --- |
  | 2020 | GHS 1.2bn [3] | ... |
  Still cite each row with [n] markers. Add a short paragraph of analysis (trends, changes, anomalies) after the table.
- For analytical questions (trends, growth %, totals, anomalies) — show the underlying figures and a brief calculation/reasoning, not just the final number.
- NEVER write out a long digit-by-digit addition or a running sum with many terms (e.g. "8000 + 7 + 9000 + ... = 1,1,1,1..."). This applies to ANY cumulative/total figure spanning more than ~5 years or items: do NOT write an expression like "A + B + C + ... = total" at all, even once, no matter how short each term looks. Instead either (a) state the final total as a single number with a short note like "(sum of the per-year figures above)", or (b) say a precise cumulative total isn't available from the excerpts and instead give the approximate range of the per-year figures. If you find yourself about to repeat the same token or digit many times in a row, STOP and instead say the figure cannot be reliably computed from the available excerpts.
- Every numeric figure you state must be a real value that appears in the DOCUMENT EXCERPTS or VALIDATED FACTS — never substitute a citation number, footnote number, or page number for a financial figure. If the only "figures" near a topic in the excerpts look like small reference numbers (e.g. 1-60) rather than budget amounts, treat that year/item as having no figure available and say so explicitly.
- Reproduce numbers, names, and dates EXACTLY as they appear in the excerpts (same digits, units, and precision) — do not round, reformat, or state a figure that was derived/extrapolated rather than written in the source. If you compute a total, growth rate, or other derived figure, briefly show which excerpt values it was calculated from.
- When listing multiple points (e.g. an "Analysis" section with several observations, a list of risks, or a list of recommendations) — put EACH point on its OWN line as a separate numbered (1. 2. 3.) or bulleted (- ) item, with a blank line before the list. NEVER run multiple points together in one paragraph. If using numbers, they MUST increase sequentially (1, 2, 3, 4, 5, ...) for the whole list — never restart at 1 partway through or repeat the same number for multiple items.
- Do NOT use markdown headings (#, ##, ###) anywhere in the answer. For section labels (e.g. "Analysis of Trends", "Key Findings"), use a bold line on its own (e.g. "**Analysis of Trends**") followed by a blank line, then the content/list.
- If figures for some years/items are missing from the excerpts, say so explicitly (e.g. "No figure found for 2003 in the available excerpts") rather than omitting them silently — this helps the user know what to check manually.
- HALLUCINATION PREVENTION — never invent figures, guess missing values, fabricate trends, or fabricate ministry/department allocations. If the excerpts and inventory genuinely contain nothing useful for the question, respond in [ANSWER] with exactly: "Insufficient evidence found in the available documents." and leave [RISKS]/[RECS] as "None identified" / omitted.
- If no relevant excerpts were found but a document exists in the inventory, acknowledge the document exists and suggest the user ask more specific questions about its content
- When the user asks to "open", "show", "view", or "read" a document — you cannot open files directly in this chat. Respond by summarising the key contents you have from the document excerpts, and tell the user they can view the full document in the Documents section.
- RECOMMENDATIONS must be specific and actionable — only include them if there is a genuine next step (e.g. "Review clause 4.2 on payment terms before signing"). Never add generic filler like "feel free to ask if you have more questions" as a recommendation.
- SELF-CHECK — before finalizing, re-read your draft [ANSWER] sentence by sentence. For each sentence that states a fact, figure, date, or name, confirm a cited excerpt or VALIDATED FACTS row actually supports it. Remove or rewrite any sentence that fails this check rather than leaving an uncited or unsupported claim in the final answer.

Format your response EXACTLY like this (no other format):

[ANSWER]
Your detailed answer here with inline citations like [1]

[RISKS]
• risk 1 (write "None identified" if there are no risks)

[RECS]
• recommendation 1 (omit this section entirely if there are no specific actionable recommendations)`

// Additional rules for budget/financial questions — only appended when
// PRE-COMPUTED/VALIDATED FACTS blocks are actually present in the prompt
// (i.e. this tenant has financial_facts data relevant to the query).
export const FINANCIAL_SYSTEM_PROMPT_ADDENDUM = `

Additional rules for financial/budget figures:
- PLAUSIBILITY CHECK for multi-year series (e.g. "total budget for each year"): values for the same metric across consecutive years should be the same order of magnitude — a steadily growing/shrinking economy does not jump by more than ~10x from one year to the next. If a candidate figure for one year is more than ~10x larger or smaller than the figures for neighboring years in the same series, it is almost certainly a misread footnote/table-row/page number, NOT the real figure. In that case, do NOT put that number in the table — instead write "No reliable figure found for [year]" for that row, and do not include it in any trend/growth analysis.
- REPEATED-VALUE CHECK for multi-row tables (per-year figures, per-sector percentages, per-item amounts, etc.): if you find yourself about to write the EXACT SAME number (currency figure OR percentage) for more than 2 different rows/years/sectors, STOP — this is a strong sign you found one real figure and are reusing it as a placeholder for everything else, rather than reading a distinct figure for each row from the excerpts. Each row's figure must be individually traceable to that specific year/sector/item in the excerpts or VALIDATED FACTS. If you cannot find a distinct figure for a row, write "No reliable figure found" for that row instead of repeating another row's number — never pad a table by duplicating a value.
- Every percentage you compute (e.g. "% increase over the past decade") must be calculated from two REAL figures for that SPECIFIC sector/item — its own start and end values — never reuse a percentage (or absolute change) computed for one sector as the value for a different sector.
- A "PRE-COMPUTED FIGURES & GROWTH" block may be provided below the excerpts — these year-over-year growth percentages were calculated deterministically from the source figures and are VERIFIED CORRECT for the metric named in each line's label (e.g. "Total Expenditure", "Net Domestic Financing"). When discussing growth/change between those years, use these exact numbers rather than recalculating, and cite the same [n] markers shown for each one — but ONLY if the line's label matches the metric the question is actually asking about. If a line's label refers to a different metric (e.g. it says "Net Domestic Financing" but the question asks about total budget allocation), do not present that figure or growth rate as if it answers the question.
- "PRE-COMPUTED CAGR", "PRE-COMPUTED FORECAST", and "PRE-COMPUTED TOTAL" blocks may also be provided — these are deterministically calculated and VERIFIED CORRECT. Use these exact numbers verbatim (with their [n] citations) instead of computing a compound growth rate, projection, or sum yourself. The forecast figure is an ESTIMATE — present it as such.
- "CUMULATIVE ALLOCATION", "TOP N BY % GROWTH", "PROPORTION OF TOTAL BUDGET", "TREND SUMMARY", "DEVIATION DETECTION", and "PRE-COMPUTED FORECAST FROM VALIDATED FACTS" blocks may also be provided — these are deterministically computed from VALIDATED FACTS and are authoritative for the analytical question asked (rankings, cumulative totals, proportions, trends, anomalies, projections). Present these values directly with their [n] citations rather than recomputing. If a block includes a "Years covered" or coverage note showing fewer years than the full requested period, explicitly state that the result is based on partial data and name the gap — never present a partial-coverage result as if it covers the full period.
- If any of the above analysis blocks states there is "no data", "cannot compute", "no validated ... facts found", or similar for a specific entity/metric/range, that statement is FINAL and AUTHORITATIVE for that part of the question — do NOT then go searching the document excerpts for a substitute figure or table to fill the gap. Tell the user plainly that validated data is insufficient for that specific part, and answer only the parts of the question that the VALIDATED FACTS / analysis blocks DO support. Do not blend a "no data" block with an excerpt-derived fabrication in the same answer.
- A "VALIDATED FACTS" block may be provided below the excerpts — these values come from a separate validation pipeline and are the authoritative source for any figure they cover. Prefer them over the document excerpts when both are present for the same year/entity/metric. Never alter, round differently, or recompute these values. Each row in this block has its own [n] citation marker in the "Source" column — cite that marker when you use the row's value, exactly like citing a document excerpt. Facts listed under "FLAGGED — DO NOT USE" are known anomalies; never state them as fact, but you may mention them if the user is asking about anomalies/inconsistencies. If the VALIDATED FACTS block says no facts were found for the requested year/entity, and the excerpts don't clearly support a figure either, respond with the insufficient-evidence message rather than guessing from prose.`

// Per-query-type guidance appended to the user message — steers the model
// toward the right pipeline (Retrieve -> ... -> Answer) for each category
// without needing separate prompts/routes.
export const QUERY_TYPE_GUIDANCE: Record<QueryType, string> = {
  fact_lookup: 'QUERY TYPE: Fact lookup. Find the specific figure(s) requested, state them plainly with citations, and verify they appear in the excerpts before answering.',
  trend: 'QUERY TYPE: Trend analysis. Extract the relevant figures for each year/period from the excerpts and the PRE-COMPUTED FIGURES & GROWTH block, then describe the trend (direction, magnitude, anomalies) using those verified numbers.',
  comparison: 'QUERY TYPE: Comparison. Aggregate the relevant figures for each item being compared into a markdown table, then write a short comparative analysis (which is larger/smaller, by how much, and why if evident).',
  forecast: 'QUERY TYPE: Forecasting. If a PRE-COMPUTED FORECAST block is provided, use its projection and base figures directly. Otherwise build a simple time series from the figures in the excerpts and describe the recent trend. Clearly label any projection as an ESTIMATE based on historical trend, not a guaranteed figure, and state the assumption.',
  evidence: 'QUERY TYPE: Evidence search. Quote the most relevant passages verbatim (in quotation marks) with citations, and briefly explain how each quote supports or relates to the claim in the question.',
  anomaly_detection: 'QUERY TYPE: Anomaly detection. Check the VALIDATED FACTS block for any entries flagged "FLAGGED — DO NOT USE" and report them as the anomalies/inconsistencies, explaining briefly why each was flagged (e.g. exceeds national budget, implausible year-over-year growth). If none are flagged, say no anomalies were found in the validated facts for this query.',
  general: '',
}

export function parseDelimited(text: string) {
  const answerMatch = text.match(/\[ANSWER\]([\s\S]*?)(?=\n\[RISKS\]|\n\[RECS\]|$)/)
  const risksMatch  = text.match(/\[RISKS\]([\s\S]*?)(?=\n\[RECS\]|$)/)
  const recsMatch   = text.match(/\[RECS\]([\s\S]*)$/)

  const parseList = (s: string | undefined) =>
    (s ?? '').split('\n')
      .map(l => l.replace(/^[•\-*]\s*/, '').trim())
      .filter(l => l && l.toLowerCase() !== 'none identified' && l.toLowerCase() !== 'none')

  return {
    answer:          answerMatch?.[1]?.trim() ?? text.trim(),
    risks:           parseList(risksMatch?.[1]),
    recommendations: parseList(recsMatch?.[1]),
  }
}

const HIGHLIGHT_STOPWORDS = new Set([
  'the','a','an','of','in','on','at','to','for','and','or','is','are','was',
  'were','what','which','who','whom','how','why','when','where','do','does',
  'did','this','that','these','those','with','from','by','as','it','its','be',
  'been','being','have','has','had','will','would','could','should','can',
  'may','might','we','you','i','he','she','they','them','their','our','your',
  'my','his','her','not','no','yes','about','into','than','then','there',
  'here','also','any','all','some','such','first','last','give','show','tell',
  'find','get','document','section',
])

// Finds the sentence within a chunk that best overlaps the user's question,
// so the source viewer can highlight "the part we were looking for" instead
// of dumping the whole excerpt and leaving the user to hunt for it.
function findHighlightSpan(chunkText: string, query: string): [number, number] | null {
  const tokens = (query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
    .filter(t => !HIGHLIGHT_STOPWORDS.has(t))
  if (!tokens.length) return null

  // Every chunk is prepended with "[Document: Title]\n" at index time (see
  // documents/upload/route.ts) so filename searches work — skip it here, since
  // it shares words with the query (e.g. "budget", "2008") but isn't content.
  const prefixMatch = chunkText.match(/^\[Document:[^\]]*\]\n?/)
  const offset = prefixMatch ? prefixMatch[0].length : 0
  const body   = chunkText.slice(offset)

  // Require overlap on at least two distinct query terms (or all of them, for
  // very short queries) so a single incidental word match — e.g. "budget"
  // appearing in an unrelated number table — doesn't get highlighted.
  const minScore = Math.min(2, tokens.length)

  const sentenceRe = /[^.!?\n]+[.!?]?/g
  let best: { start: number; end: number; score: number } | null = null
  let match: RegExpExecArray | null
  while ((match = sentenceRe.exec(body))) {
    const sentence = match[0]
    if (sentence.trim().length < 12) continue
    const lower = sentence.toLowerCase()
    const score = tokens.reduce((acc, t) => acc + (lower.includes(t) ? 1 : 0), 0)
    if (score >= minScore && (!best || score > best.score)) {
      best = { start: offset + match.index, end: offset + match.index + sentence.length, score }
    }
  }
  return best ? [best.start, best.end] : null
}

function sseHeaders() {
  return { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }
}

// Stream a message word-by-word so the UI shows a typing effect
async function streamWords(
  controller: ReadableStreamDefaultController,
  enc: TextEncoder,
  text: string,
  meta: Record<string, unknown>,
) {
  const words = text.split(' ')
  for (let i = 0; i < words.length; i++) {
    const token = (i === 0 ? '' : ' ') + words[i]
    controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: token })}\n\n`))
    await new Promise(r => setTimeout(r, 28))
  }
  controller.enqueue(enc.encode(`data: ${JSON.stringify({ done: true, answer: text, ...meta })}\n\n`))
  controller.close()
}

// Detects questions that need coverage across MANY documents at once — e.g.
// "total budget for each year from 1999-2026" against 27 separate yearly
// budget files. A single global top-K vector search can only return chunks
// from a handful of the most-similar documents, so most years get silently
// dropped. These queries need at least one chunk from every ready document.
export const BROAD_QUERY_RX = /\beach year\b|\bevery year\b|\byear[\s-]?(over|on)[\s-]?year\b|\b(all|both|across)\b.*\byears?\b|\bover the (years|decade|period)\b|\b(19|20)\d{2}\s*(?:[-–—]|to)\s*(19|20)\d{2}\b|\bcumulative\b|\btrend\b|\b\d{1,3}[\s-]?years?\b/i

// Generic cross-document questions (e.g. "summarize what our policies say
// about X across all files") — not budget-shaped, so BROAD_QUERY_RX won't
// catch them, but they still need at least one chunk from every document
// rather than just the top-10 globally-similar chunks.
export const CROSS_DOCUMENT_RX = /\b(all|every|each|across)\b.*\b(documents?|files?|contracts?|policies|policy|reports?|agreements?)\b|\bsummari[sz]e\b.*\b(all|our|every)\b|\boverview of (all|our)\b/i

// Questions about the knowledge base's contents/inventory itself (e.g. "do
// we have X?", "what files exist?") — the inventory passed to the model is
// the complete, authoritative list, so a "no chunks matched" answer here is
// a definitive statement about system state, not a failed retrieval.
const INVENTORY_QUERY_RX = /\b(do|does)\s+(we|you|i)\b.{0,20}\bhave\b|\bis there (a|any)|are there (any)?|what files|which files|list (of )?(the |all )?(files|documents)|how many (files|documents)|\bany (files|documents)\b/i

// Query types for which validated financial_facts are looked up and an
// AI second-pass verifier checks the answer against them.
export const FACTS_QUERY_TYPES: QueryType[] = ['fact_lookup', 'trend', 'comparison', 'forecast', 'anomaly_detection', 'evidence']

// Questions asking for a combined/total figure across multiple items
// (e.g. "what was the total of X and Y", "combined allocation for ...") —
// triggers computeAggregate() so the model is handed a pre-summed total
// instead of adding several figures itself.
const AGGREGATE_QUERY_RX = /\b(total|combined|sum|altogether|aggregate|add (up|together))\b/i

// Derive a short memorable title from the query
function makeTitle(query: string): string {
  const q = query.trim().replace(/[?!.]+$/, '')
  if (q.split(/\s+/).length <= 3) return q || 'Quick chat'
  const words = q.split(/\s+/).slice(0, 6)
  return words.join(' ') + (q.split(/\s+/).length > 6 ? '…' : '')
}

/* ── GET: conversation history, or citations for a conversation ─── */
export async function GET(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = await createClient()

  const convId = new URL(request.url).searchParams.get('citations')
  if (convId) {
    // RLS (citations_select) restricts this to citations on conversations
    // owned by the calling user.
    const { data } = await supabase
      .from('citations')
      .select(`
        id, document_chunk_id, relevance_score, message_index,
        document_id, fact_label, page_number, section_title,
        document_chunks(chunk_text, document_id, metadata, documents(title)),
        documents(title)
      `)
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })

    const citations = (data ?? []).map(row => {
      const chunk = Array.isArray(row.document_chunks) ? row.document_chunks[0] : row.document_chunks
      // Fact-based citations (see migration 017) carry no document_chunk_id
      // — fall back to their own synthetic label/document/page/section
      // instead of a joined chunk.
      if (!chunk) {
        const rawDocs = row.documents as { title: string } | { title: string }[] | null | undefined
        const docTitle = Array.isArray(rawDocs) ? rawDocs[0]?.title : rawDocs?.title
        return {
          id: row.id,
          conversation_id: convId,
          document_chunk_id: null,
          document_id: row.document_id ?? '',
          document_title: docTitle ?? 'Document',
          chunk_text: row.fact_label ?? '',
          relevance_score: row.relevance_score,
          highlight: null,
          page_number: row.page_number,
          section_title: row.section_title,
          message_index: row.message_index as number | null,
        }
      }
      const rawDocs = chunk.documents as { title: string } | { title: string }[] | null | undefined
      const docTitle = Array.isArray(rawDocs) ? rawDocs[0]?.title : rawDocs?.title
      const meta = (chunk.metadata ?? {}) as Record<string, unknown>
      return {
        id: row.id,
        conversation_id: convId,
        document_chunk_id: row.document_chunk_id,
        document_id: chunk.document_id ?? '',
        document_title: docTitle ?? 'Document',
        chunk_text: chunk.chunk_text ?? '',
        relevance_score: row.relevance_score,
        highlight: null,
        page_number: (meta.page_number as number | null) ?? null,
        section_title: (meta.section_title as string | null) ?? null,
        // Which AI message (index into conversations.messages) this
        // citation belongs to — null for rows inserted before migration 012.
        message_index: row.message_index as number | null,
      }
    })

    return NextResponse.json({ citations })
  }

  const { data } = await supabase
    .from('conversations')
    .select('id, query, response, risks, recommendations, messages, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(60)

  return NextResponse.json({ conversations: data ?? [] })
}

/* ── DELETE: remove a conversation ────────────────────────── */
export async function DELETE(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = await createClient()

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Verify ownership with the authenticated client first
  const { data: owned } = await supabase
    .from('conversations').select('id').eq('id', id).eq('user_id', user.id).maybeSingle()

  if (!owned) return NextResponse.json({ error: 'Not found or not yours' }, { status: 404 })

  // Use service role to bypass RLS for the actual deletion
  // (RLS DELETE policies may not be set up — we've already verified ownership above)
  const { createClient: createService } = await import('@supabase/supabase-js')
  const service = createService(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  await service.from('citations').delete().eq('conversation_id', id)
  const { error } = await service.from('conversations').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

/* ── POST: streaming chat ─────────────────────────────────── */
export async function POST(request: NextRequest) {
  // Both calls served from module-level cache after first request — near zero latency
  const [user, membership] = await Promise.all([getUser(), getMembership()])
  if (!user)       return new Response('Unauthorized', { status: 401 })
  if (!membership) return new Response('No workspace',  { status: 403 })

  const tenant = await getTenant(membership.tenant_id)
  const orgName = tenant?.name ?? 'NyasapoAI'
  const orgDescription = tenant?.description ?? DEFAULT_TENANT_DESCRIPTION

  const supabase = await createClient()

  let body: unknown
  try { body = await request.json() } catch { return new Response('Invalid JSON body', { status: 400 }) }
  const { query: rawQuery, newSession = true, history = [], convId: existingConvId = null } = (body ?? {}) as {
    query?: unknown; newSession?: boolean; history?: unknown; convId?: string | null
  }
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) return new Response('Query required', { status: 400 })
  const query: string = rawQuery

  // Recent conversation history, capped so a long-running conversation can't
  // push the prompt over the org's 10k input-tokens/min limit (same class of
  // issue as MAX_CONTEXT_CHUNKS/MAX_CHUNK_CHARS below).
  type HistMsg = { role: 'user' | 'assistant'; content: string }
  const MAX_HISTORY_MESSAGES = 6
  const MAX_HISTORY_CHARS = 1200
  // Index this turn's AI message will occupy in conversations.messages —
  // used to scope citation rows to the message that cited them (see
  // migration 012_citation_message_index).
  const rawHistoryLength = Array.isArray(history) ? history.length : 0
  const historyMsgs: HistMsg[] = (Array.isArray(history) ? (history as HistMsg[]) : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY_MESSAGES)
    .map(m => ({ ...m, content: m.content.length > MAX_HISTORY_CHARS ? m.content.slice(0, MAX_HISTORY_CHARS) + '…' : m.content }))

  const enc = new TextEncoder()
  const tenantId = membership.tenant_id

  type StoredMessage = { role: string; text: string; risks?: string[]; recommendations?: string[] }

  // Insert a new conversation row (first message of a session).
  async function saveConv(answer: string, risks: string[], recommendations: string[], confidence = 0.85): Promise<string | null> {
    try {
      const messages: StoredMessage[] = [
        { role: 'user', text: query },
        { role: 'ai',   text: answer, risks, recommendations },
      ]
      const { data, error } = await supabase
        .from('conversations')
        .insert({
          user_id: user!.id, tenant_id: tenantId,
          query, response: answer, confidence_score: confidence, risks, recommendations,
          messages,
        })
        .select('id')
        .single()
      if (error) { console.error('Conv save error:', error.message); return null }
      return data?.id ?? null
    } catch (e) { console.error('Conv save failed:', e); return null }
  }

  // Append a user+AI pair to an existing conversation (subsequent messages).
  async function appendConv(id: string, answer: string, risks: string[], recommendations: string[]): Promise<void> {
    try {
      const newMessages: StoredMessage[] = [
        { role: 'user', text: query },
        { role: 'ai',   text: answer, risks, recommendations },
      ]
      const { error } = await supabase.rpc('append_conversation_messages', {
        p_conversation_id: id,
        p_user_id:         user!.id,
        p_new_messages:    newMessages,
      })
      if (error) console.error('Conv append error:', error.message)
    } catch (e) { console.error('Conv append failed:', e) }
  }

  /* ── Small talk shortcut ──────────────────────────────────── */
  const smallTalkRx = /^(hi+|hello+|hey+|good\s?(morning|afternoon|evening)|howdy|hiya|greetings|yo|what'?s up|sup|ok(ay)?|alright|sure|got\s*it|noted|understood|thanks?|thank\s*you|cheers|perfect|great|sounds?\s*good|makes?\s*sense|i\s*see|nice|cool|awesome|wonderful|brilliant|excellent|amazing|yes|no|yep|nope|yeah|nah|absolutely|definitely|of\s*course|certainly|bye|goodbye|see\s*you|take\s*care|later|cya|no\s*worries|no\s*problem|appreciate\s*(it|that)?|well\s*done|good\s*job|interesting|i\s*understand)[!?.,\s]*$/i
  if (smallTalkRx.test(query.trim())) {
    const firstName = (user.user_metadata?.name || user.email?.split('@')[0] || 'there').split(/\s+/)[0]
    const msg = await claudeComplete({
      temperature: 0.7, maxTokens: 120,
      system: `You are ${orgName} AI, a friendly AI document assistant for ${orgName} — ${orgDescription}. The user sent a short conversational message. Reply warmly in 1–2 sentences. Address them as ${firstName}. Stay in character. Gently remind them you can help with documents if appropriate. Use the conversation history below to understand context before responding.`,
      messages: [
        ...historyMsgs,
        { role: 'user', content: query },
      ],
    }).catch(() => '') || `You're welcome, ${firstName}! Let me know whenever you have a question about your documents.`

    const title = makeTitle(query)
    let convId: string | null = null
    if (newSession) {
      convId = await saveConv(msg, [], [], 1)
    } else if (existingConvId) {
      convId = existingConvId
      await appendConv(existingConvId, msg, [], [])
    }

    return new Response(
      new ReadableStream({ async start(c) {
        await streamWords(c, enc, msg, { risks: [], recommendations: [], citations: [], confidence_score: 100, confidence_level: 'High', convId, title })
      }}),
      { headers: sseHeaders() }
    )
  }

  try {
    /* ── 1. Embed query + fetch platform tenant + document inventory ── */
    const svc = getServiceClient()

    const [embRes, { data: docInventory }] = await Promise.all([
      fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST', headers: OPENAI_HEADERS,
        body: JSON.stringify({ model: 'text-embedding-3-small', input: query }),
      }),
      svc.from('documents')
        .select('title, department, status')
        .eq('tenant_id', tenantId)
        .eq('status', 'ready')
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    const embData = await embRes.json()
    const queryEmbedding = embData.data[0].embedding

    // Inventory is shown FIRST so the AI always knows what files exist
    const inventoryText = (docInventory ?? []).length
      ? `KNOWLEDGE BASE INVENTORY (${(docInventory ?? []).length} file${(docInventory ?? []).length !== 1 ? 's' : ''}):\n` +
        (docInventory ?? []).map(d => `• ${d.title}${d.department ? ` [category: ${d.department}]` : ''}`).join('\n')
      : 'KNOWLEDGE BASE INVENTORY: No files have been uploaded yet.'

    /* ── 2. Hybrid retrieval (dense vector + BM25-ish FTS via RRF) ──
       Tenant isolation enforced by p_tenant_id — this is safe.
       Returns up to 30 candidates, reranked down to the top 10. */
    const { data: hybridChunks, error: rpcError } = await svc.rpc('match_document_chunks_hybrid', {
      query_embedding: queryEmbedding, query_text: query, p_tenant_id: tenantId,
      match_count: 30, p_platform_tenant_id: null,
    })
    if (rpcError) console.error('[RAG] hybrid RPC error:', JSON.stringify(rpcError))

    type RetrievedChunk = { id: string; document_id: string; chunk_text: string; metadata: Record<string, unknown>; similarity: number; rrf_score?: number; rerank_score?: number }
    const candidateChunks: RetrievedChunk[] = (hybridChunks ?? []) as RetrievedChunk[]

    // If the hybrid RPC returned nothing (can happen when migration 016 broke
    // the function body), fall back to a direct FTS query on document_chunks.
    // This keeps retrieval working until the RPC is restored via rollback SQL.
    if (!candidateChunks.length) {
      const { data: ftsChunks } = await svc
        .from('document_chunks')
        .select('id, document_id, chunk_text, metadata')
        .eq('tenant_id', tenantId)
        .textSearch('fts', query, { type: 'websearch', config: 'english' })
        .limit(30)
      if (ftsChunks?.length) {
        console.log(`[RAG] FTS fallback: ${ftsChunks.length} chunks`)
        for (const c of ftsChunks) candidateChunks.push({ ...c, similarity: 0.5, rrf_score: 0.016 })
      }
    }

    // A query naming exactly one fiscal year (e.g. "Ministry of Health
    // allocation in 2021") can have its correct-year chunk outranked by a
    // more textually-similar chunk from a DIFFERENT year's budget document.
    // Supplement the candidate pool with chunks whose generated fiscal_year
    // column matches the query's year, so the reranker has them available —
    // this only ADDS candidates, never narrows the pool, so it can't cause
    // an empty result if the metadata column is unset for older chunks.
    const queryYears = [...new Set(query.match(/\b(19|20)\d{2}\b/g) ?? [])]
    if (queryYears.length === 1) {
      const { data: filteredChunks, error: filteredError } = await svc.rpc('match_document_chunks_hybrid_filtered', {
        query_embedding: queryEmbedding, query_text: query, p_tenant_id: tenantId,
        match_count: 15, p_fiscal_year: queryYears[0],
      })
      if (filteredError) console.error('[RAG] filtered hybrid RPC error:', JSON.stringify(filteredError))
      if (filteredChunks?.length) {
        const seen = new Set(candidateChunks.map(c => c.id))
        for (const c of filteredChunks as RetrievedChunk[]) {
          if (!seen.has(c.id)) { candidateChunks.push(c); seen.add(c.id) }
        }
      }
    }

    const chunks: RetrievedChunk[] = candidateChunks.length
      ? await rerankChunks(query, candidateChunks, 10)
      : []

    if (chunks.length) {
      console.log('[RAG] retrieval scores:', chunks.map(c => ({
        id: c.id.slice(0, 8), similarity: c.similarity?.toFixed(3), rrf: c.rrf_score?.toFixed(4), rerank: c.rerank_score?.toFixed(2),
      })))
    }

    // Broad/aggregation question (e.g. "X for each year from 1999-2026") OR a
    // comparison/trend question (e.g. "compare X in 2012 with Y in 2026") —
    // both need evidence that may live in different documents/sections than
    // whichever single chunk the hybrid query happens to rank highest. Pull
    // a few top chunks from EVERY ready document (one fast RPC call) so no
    // year/file/sector is silently dropped, then merge with the reranked
    // top-N above.
    const earlyQueryType = classifyQuery(query)
    const isDeepSearch = BROAD_QUERY_RX.test(query) || CROSS_DOCUMENT_RX.test(query) || earlyQueryType === 'comparison' || earlyQueryType === 'trend'
    if (isDeepSearch) {
      let { data: perDocChunks, error: perDocError } = await svc.rpc('match_document_chunks_per_doc', {
        query_embedding: queryEmbedding, p_tenant_id: tenantId,
        match_count_per_doc: 3, match_threshold: 0.05, p_platform_tenant_id: null,
      })
      if (perDocError) console.error('[RAG] per-doc RPC error:', JSON.stringify(perDocError))

      // Per-doc RPC also affected by migration 016 — fall back to a direct
      // scan that takes up to 3 chunks per document, ordered by chunk_index
      // so we get the document's opening sections (most likely to name the
      // fiscal year and entity totals) rather than an arbitrary subset.
      if (!perDocChunks?.length) {
        const { data: scanChunks } = await svc
          .from('document_chunks')
          .select('id, document_id, chunk_text, metadata')
          .eq('tenant_id', tenantId)
          .order('document_id')
          .order('chunk_index')
          .limit(200)
        if (scanChunks?.length) {
          const docCount = new Map<string, number>()
          const sampled: RetrievedChunk[] = []
          for (const c of scanChunks) {
            const cnt = docCount.get(c.document_id) ?? 0
            if (cnt < 3) { sampled.push({ ...c, similarity: 0.3, rrf_score: 0.008 }); docCount.set(c.document_id, cnt + 1) }
          }
          console.log(`[RAG] per-doc fallback: ${sampled.length} chunks from ${docCount.size} docs`)
          perDocChunks = sampled as typeof perDocChunks
        }
      }

      if (perDocChunks?.length) {
        // match_document_chunks_per_doc returns rows ordered "document_id,
        // rn" — i.e. up to 3 consecutive chunks per document, documents in
        // arbitrary UUID order. The MAX_CONTEXT_CHUNKS truncation below would
        // then keep all 3 chunks from only the first ~2 documents in that
        // order and drop every other document entirely, defeating the
        // "every ready document contributes" guarantee this RPC exists for.
        // Interleave round-robin (each document's rn=1 chunk first, then
        // rn=2, etc.) so truncation instead trims the LEAST-similar chunk
        // from the GREATEST number of documents.
        const byDoc = new Map<string, RetrievedChunk[]>()
        for (const c of perDocChunks as RetrievedChunk[]) {
          const arr = byDoc.get(c.document_id)
          if (arr) arr.push(c)
          else byDoc.set(c.document_id, [c])
        }
        const groups = [...byDoc.values()]
        const maxLen = Math.max(...groups.map(g => g.length))
        const interleaved: RetrievedChunk[] = []
        for (let i = 0; i < maxLen; i++) {
          for (const g of groups) if (g[i]) interleaved.push(g[i])
        }
        const seen = new Set(chunks.map(c => c.id))
        for (const c of interleaved) if (!seen.has(c.id)) { chunks.push(c); seen.add(c.id) }
      }
    }

    // Cap total chunks sent to Claude. isDeepSearch can pull in up to 3
    // chunks per document — for a tenant with many yearly budget files this
    // can push the prompt (excerpts + VALIDATED FACTS table + system prompt)
    // over the org's 10,000 input-tokens/min limit, surfacing as a 429. The
    // highest-ranked reranked chunks are first in the array, so truncating
    // keeps those and trims the lowest-ranked per-doc additions.
    // isDeepSearch queries (broad "for each year"/comparison/trend) are the
    // ones that both pull the most per-doc chunks AND populate the largest
    // VALIDATED FACTS + analysis blocks (which the system prompt already
    // treats as the authoritative source for those queries) — so trim
    // excerpts more aggressively for them specifically, rather than for
    // every query.
    const MAX_CONTEXT_CHUNKS = isDeepSearch ? 10 : 15
    if (chunks.length > MAX_CONTEXT_CHUNKS) chunks.length = MAX_CONTEXT_CHUNKS

    /* ── No matching chunks — answer from inventory ─────────── */
    if (!chunks?.length) {
      const msg = await claudeComplete({
        temperature: 0.4, maxTokens: 250,
        system: `You are ${orgName} AI, the assistant for ${orgName} (${orgDescription}).
No specific document excerpts matched this query, but you have the complete file inventory below.
IMPORTANT: If the user asks whether a file or category of document exists, CHECK the inventory and answer directly — "Yes, we have..." or "No, there are none...". Never say you cannot access files when they appear in the inventory. Be specific about names and categories.`,
        messages: [
          ...historyMsgs,
          { role: 'user', content: `${inventoryText}\n\nQuestion: ${query}` },
        ],
      }).catch(() => '') || "I couldn't find relevant content for that query. Check the Documents section to see what has been uploaded, or try rephrasing your question."

      // An inventory question (or a knowledge base with no files at all) is
      // answered directly and definitively from the inventory list above —
      // that's a confident, correct answer, not a failed content search.
      const isInventoryAnswer = INVENTORY_QUERY_RX.test(query) || !docInventory?.length
      const fallbackConfidence = isInventoryAnswer ? 95 : 30
      const fallbackLevel = isInventoryAnswer ? 'High' : 'Low'

      const title = makeTitle(query)
      let convId: string | null = null
      if (newSession) {
        convId = await saveConv(msg, [], [], fallbackConfidence / 100)
      } else if (existingConvId) {
        convId = existingConvId
        await appendConv(existingConvId, msg, [], [])
      }

      return new Response(
        new ReadableStream({ async start(c) {
          await streamWords(c, enc, msg, { risks: [], recommendations: [], citations: [], confidence_score: fallbackConfidence, confidence_level: fallbackLevel, convId, title })
        }}),
        { headers: sseHeaders() }
      )
    }

    // Truncate any single oversized chunk so one large chunk can't dominate
    // the input-token budget (org cap is 10k input tokens/min). isDeepSearch
    // queries already get a smaller MAX_CONTEXT_CHUNKS above for the same
    // reason — shrink the per-chunk budget too so the combined excerpts
    // block stays well under the limit even with a large VALIDATED FACTS /
    // analysis block alongside it.
    const MAX_CHUNK_CHARS = isDeepSearch ? 1200 : 2000
    const context = chunks
      .map((c, i) => `[${i + 1}] ${c.chunk_text.length > MAX_CHUNK_CHARS ? c.chunk_text.slice(0, MAX_CHUNK_CHARS) + '…' : c.chunk_text}`)
      .join('\n\n')

    /* ── 2b. Deterministic calculation engine ────────────────────
       Extract figures + compute year-over-year growth ourselves so the
       model doesn't have to (and can't get the arithmetic wrong). */
    const growthCalcs = computeGrowthCalculations(chunks)
    let calcBlock = growthCalcs.length
      ? '\n\nPRE-COMPUTED FIGURES & GROWTH (verified — use these exact numbers):\n' +
        growthCalcs.map(g =>
          `- ${g.label ? `${g.label}: ` : ''}${g.fromYear} → ${g.toYear}: ${g.fromValue} → ${g.toValue} (${g.unit}), `
          + `growth ${g.growthPct > 0 ? '+' : ''}${g.growthPct}% ${g.citations.map(n => `[${n}]`).join('')}`
        ).join('\n')
      : ''

    const queryType = earlyQueryType
    const guidance = QUERY_TYPE_GUIDANCE[queryType]
    const guidanceBlock = guidance ? `\n\n${guidance}` : ''

    // Chart data (historical + projected series) for trend/forecast answers
    // — sent to the client alongside the answer for inline visualization.
    // May be overwritten below by a more specific financial_facts-based chart.
    let chartData: ChartData | null = null

    // CAGR: meaningful for trend/forecast questions spanning multiple years.
    if (queryType === 'trend' || queryType === 'forecast') {
      const cagr = computeCAGR(chunks)
      if (cagr) {
        calcBlock += '\n\nPRE-COMPUTED CAGR (verified — use this exact number):\n' +
          `- ${cagr.label ? `${cagr.label}: ` : ''}${cagr.fromYear} → ${cagr.toYear}: ${cagr.fromValue} → ${cagr.toValue} (${cagr.unit}), ` +
          `CAGR ${cagr.cagrPct > 0 ? '+' : ''}${cagr.cagrPct}% per year ${cagr.citations.map(n => `[${n}]`).join('')}`
      }
    }

    // Forecast: project future periods via linear trend over the figures
    // found. For 'trend' questions this only populates the chart (a light
    // projection alongside the historical series); for 'forecast' questions
    // it's also surfaced to the model as a pre-computed estimate.
    if (queryType === 'forecast' || queryType === 'trend') {
      const forecast = computeForecast(chunks)
      if (forecast) {
        chartData = {
          title: 'Historical & projected values',
          unit: forecast.unit,
          series: [
            ...forecast.baseYears.map((y, i) => ({ year: y, value: forecast.baseValues[i] })),
            ...forecast.forecastYears.map((y, i) => ({ year: y, value: forecast.forecastValues[i], projected: true })),
          ],
        }
        if (queryType === 'forecast') {
          calcBlock += '\n\nPRE-COMPUTED FORECAST (verified linear-trend projection — label as an ESTIMATE):\n' +
            `- Based on ${forecast.baseYears.join(', ')} (${forecast.baseValues.join(', ')} ${forecast.unit}), ` +
            `projected ${forecast.forecastYears[0]}: ~${forecast.forecastValues[0]} ${forecast.unit} ${forecast.citations.map(n => `[${n}]`).join('')}\n` +
            `- Multi-year outlook (ESTIMATES): ${forecast.forecastYears.map((y, i) => `${y} ~${forecast.forecastValues[i]}`).join(', ')} ${forecast.unit}`
        }
      }
    }

    // Aggregate: "total/combined/sum" questions get a pre-summed figure so
    // the model never writes out a long addition itself. Skip this for
    // per-year/trend/series questions (BROAD_QUERY_RX, e.g. "total budget
    // for EACH YEAR from 1999-2026") — those want a year-by-year breakdown,
    // not a single sum, and with no single target year computeAggregate
    // would add together figures (totals, sub-components, GDP%, different
    // fiscal years/currency eras) from across every retrieved chunk into one
    // meaningless number mislabeled with whichever year happened to come
    // first.
    if (AGGREGATE_QUERY_RX.test(query) && !BROAD_QUERY_RX.test(query)) {
      const queryYears = (query.match(/\b(19|20)\d{2}\b/g) ?? []).map((y: string) => parseInt(y, 10))
      const aggregate = computeAggregate(chunks, queryYears.length === 1 ? queryYears[0] : undefined)
      if (aggregate) {
        calcBlock += '\n\nPRE-COMPUTED TOTAL (verified — use this exact sum, do not re-add the figures yourself):\n' +
          `- ${aggregate.count} figures${aggregate.year ? ` for ${aggregate.year}` : ''} sum to ${aggregate.total} ${aggregate.unit} ${aggregate.citations.map(n => `[${n}]`).join('')}`
      }
    }

    /* ── 2c. Validated facts store ────────────────────────────────
       For numeric/analytical query types, look up pre-extracted,
       sanity-checked figures from financial_facts and hand them to the
       model as authoritative — this is what prevents wrong-table/
       wrong-year figures and implausible growth claims from prose alone. */
    let factsBlock = ''
    // Extra citation entries for VALIDATED FACTS rows, appended after the
    // chunk citations (so a row's "[n]" marker resolves to a real entry in
    // the citations panel even though it has no document_chunk_id).
    type FactCitation = {
      id: string; document_chunk_id: string | null; document_id: string; document_title: string
      chunk_text: string; relevance_score: number; highlight: [number, number] | null
      page_number: number | null; section_title: string | null
    }
    const factCitations: FactCitation[] = []
    // Maps factCitations to insertable `citations` rows (migration 017) —
    // document_chunk_id stays null; the synthetic description is stored in
    // fact_label instead of being derived from a joined chunk, so these
    // citations remain resolvable after the conversation is reloaded from
    // history (previously they only existed in the live SSE payload).
    const factCitationRows = (convId: string, facts: FactCitation[], messageIndex: number) =>
      facts.map(fc => ({
        conversation_id: convId, document_chunk_id: null, document_id: fc.document_id,
        fact_label: fc.chunk_text, page_number: fc.page_number, section_title: fc.section_title,
        relevance_score: fc.relevance_score, message_index: messageIndex,
      }))
    // Resolves document titles for fact citations — fired alongside
    // chunkDetailsPromise (not awaited here) so it doesn't block the start
    // of the Claude stream; titles are patched into factCitations afterward.
    let factDocsPromise: PromiseLike<{ data: { id: string; title: string }[] | null }> = Promise.resolve({ data: [] })
    // Handed to verifyAnswer() so it can cross-check the answer's figures
    // against ground-truth values that may not be repeated verbatim in the
    // retrieved chunk text.
    let validatedFactsForVerification: FactForVerification[] = []

    if (FACTS_QUERY_TYPES.includes(queryType)) {
      const { years, entityHint, secondEntityHint } = extractQueryFilters(query, chunks)

      // Analytical questions (cumulative totals, growth rankings,
      // proportions, trend summaries, deviations, forecasts) need a broader
      // multi-entity, multi-year dataset beyond the single (year, entity)
      // lookup below — see factsAnalysis.ts.
      const wantsCumulative = CUMULATIVE_RX.test(query)
      const wantsRanking = RANKING_RX.test(query)
      const wantsProportion = PROPORTION_RX.test(query)
      // evidence queries (Q9) need summarizeTrend to surface the numeric series
      // that proves the claim, even though they won't be classified as 'trend'.
      const wantsSummary = SUMMARY_RX.test(query) || queryType === 'trend' || queryType === 'evidence'
      const wantsAnalysis = wantsCumulative || wantsRanking || wantsProportion || wantsSummary
        || queryType === 'forecast' || queryType === 'anomaly_detection' || queryType === 'comparison'

      // "the past decade" / "previous 21 years" / "27-year period" etc. don't
      // match extractQueryFilters' explicit-year regexes — fall back to a
      // relative range computed against the latest year with a validated
      // national total_budget figure. Checked even when `years` is non-empty,
      // since extractQueryFilters falls back to whatever years happen to be
      // present in the retrieved chunks, which isn't the same as "the period
      // the user actually asked about" for these phrasings.
      const RELATIVE_RANGE_PHRASE_RX = /\bdecade\b|\b(?:previous|last|past)\s+(?:\d+|[a-z]+(?:[\s-][a-z]+)?)\s+years?\b|\b(?:\d+|[a-z]+(?:[\s-][a-z]+)?)[\s-]year\s+period\b/i
      let relativeRange: { from: number; to: number } | null = null
      if (wantsAnalysis && (!years.length || RELATIVE_RANGE_PHRASE_RX.test(query))) {
        const { data: latestRow } = await svc
          .from('financial_facts')
          .select('fiscal_year')
          .eq('tenant_id', tenantId).eq('entity_type', 'national').eq('metric', 'total_budget')
          .order('fiscal_year', { ascending: false }).limit(1).maybeSingle()
        const latestYear = latestRow?.fiscal_year ? parseInt(latestRow.fiscal_year, 10) : new Date().getFullYear()
        relativeRange = parseRelativeYearRange(query, latestYear)
        if (relativeRange) {
          // REPLACE years rather than appending — when the query explicitly
          // names a relative range ("the last decade"), that's authoritative
          // over whatever extractQueryFilters' chunkYears fallback happened
          // to infer from incidentally-retrieved old chunks (isDeepSearch
          // pulls a few chunks from EVERY ready document for a "trend"
          // query, including documents a decade outside the asked-about
          // range). Appending mixed both ranges into one `.in('fiscal_year',
          // years)` filter, and citedFacts.slice(0, 50) — ordered oldest
          // first — let the unwanted old years crowd out the actual decade
          // asked about once the row count exceeded 50.
          years.length = 0
          for (let y = relativeRange.from; y <= relativeRange.to; y++) years.push(String(y))
        }
      }

      // 144+ raw national total_budget/allocation rows now exist across
      // 1999-2026 (recent years alone have 6-16 candidate extractions
      // before confidence/flags filtering) — a 100-row cap ordered by
      // fiscal_year truncates partway through 2024, silently dropping
      // 2025/2026 from "for each year" answers even though valid facts
      // exist for them. 300 gives ~2x headroom over the current total.
      let factsQuery = svc
        .from('financial_facts')
        .select('fiscal_year, entity, entity_type, metric, value, unit, value_millions, page_number, section_title, document_id, confidence, flags')
        .eq('tenant_id', tenantId)
        .order('fiscal_year', { ascending: true })
        .limit(300)
      if (years.length) factsQuery = factsQuery.in('fiscal_year', years)
      if (entityHint === 'National') {
        // Mirror Document Search's national lookup: scope to entity_type
        // 'national' and the headline total_budget/allocation metrics, so a
        // multi-decade "for each year" query doesn't get crowded out by the
        // many other national metrics (revenue, debt, expenditure, etc.) per
        // year before hitting the row limit.
        factsQuery = factsQuery.eq('entity_type', 'national').in('metric', ['total_budget', 'allocation'])
      } else if (entityHint && secondEntityHint) {
        // Comparison query mentioning two entities (e.g. "infrastructure and education") —
        // fetch facts for both so the VALIDATED FACTS block covers both sides.
        factsQuery = factsQuery.or(`entity.ilike.%${entityHint}%,entity.ilike.%${secondEntityHint}%`)
      } else if (entityHint) {
        factsQuery = factsQuery.ilike('entity', `%${entityHint}%`)
      }

      // financial_facts is a tenant-wide, budget-specific store — gate the
      // actual query on whether the retrieved chunks are even budget-shaped
      // (see hasBudgetContext below) so a question entirely about a
      // non-budget document doesn't pull in budget rows for whatever
      // year/entity happened to be inferred from a weakly-retrieved chunk,
      // and instead falls through to the document_facts branch below.
      // `chunks` is reranked best-first, but can still include several
      // low-relevance documents padding out the top 10 (isDeepSearch's
      // per-document supplementation guarantees SOME chunk from every
      // ready document, however weak the match) — checking the WHOLE array
      // means one such low-relevance budget chunk among nine genuinely
      // relevant non-budget chunks still flips this on. Only the top 3
      // (the chunks the answer is actually likely to be built from) should
      // count as a real signal that this question is budget-related.
      const hasBudgetContext = chunks.slice(0, 3).some(c => c.metadata?.fiscal_year != null)
      const { data: facts, error: factsError } = hasBudgetContext
        ? await factsQuery
        : { data: [] as Awaited<typeof factsQuery>['data'], error: null }
      if (factsError) console.error('[RAG] financial_facts query error:', JSON.stringify(factsError))

      const validFacts = (facts ?? []).filter(f => f.confidence >= 70 && !(f.flags as string[])?.length)
      // Anomalies are only useful (and safe to show) for anomaly-detection
      // queries — for any other query type, surfacing "FLAGGED — DO NOT USE"
      // rows just adds noise/risk of the model citing a known-bad value.
      const flaggedFacts = queryType === 'anomaly_detection'
        ? (facts ?? []).filter(f => (f.flags as string[])?.length)
        : []

      validatedFactsForVerification = validFacts.map(f => ({ value_millions: f.value_millions }))

      // Broader dataset (all entity types, no row-cap-per-entity issue) for
      // the analytical computations below.
      let analysisFacts: FactRow[] = []
      if (hasBudgetContext && wantsAnalysis) {
        const FACTS_SELECT = 'fiscal_year, entity, entity_type, metric, value, unit, value_millions, page_number, section_title, document_id, confidence, flags'
        // National facts are few (a few dozen per metric) — fetch them all,
        // unconditionally, so plausibility checks (entity allocation vs.
        // national total) and national-level trend/forecast/cumulative
        // computations always have the full series regardless of the
        // ministry/sector row cap below.
        const nationalQuery = svc
          .from('financial_facts')
          .select(FACTS_SELECT)
          .eq('tenant_id', tenantId)
          .gte('confidence', 70)
          .eq('entity_type', 'national')
          .limit(500)

        // Ministry/sector facts can number in the thousands (many line items
        // per document) — far more than a single query can return. Order by
        // value_millions desc so the largest (most "headline") allocations —
        // the ones cumulative/ranking questions care about — are the ones
        // kept within the row cap, rather than an arbitrary subset.
        // MDA appendix tables contain thousands of line-item rows — many
        // mis-extracted with a bare row-code as "entity" (e.g. "293", "8
        // Sissala West") and an implausibly large value_millions (often
        // >GH¢90bn for a single line). Ordered by value_millions desc, these
        // garbage rows dominate the top of a 1000-row cap and crowd out real
        // "Ministry of X" rows for most years. Restrict entity_type=ministry
        // rows to actual ministry votes ("Ministry of ..." / "Sub-Total
        // Ministry of ..."); sector rows (from a small fixed keyword list)
        // are already clean and pass through unchanged.
        let ministryQuery = svc
          .from('financial_facts')
          .select(FACTS_SELECT)
          .eq('tenant_id', tenantId)
          .gte('confidence', 70)
          .in('entity_type', ['ministry', 'sector'])
          .or('entity_type.eq.sector,entity.ilike.%ministry of%')
          .order('value_millions', { ascending: false })
          .limit(1000)
        if (years.length) ministryQuery = ministryQuery.in('fiscal_year', years)

        const [{ data: nationalRows, error: nError }, { data: ministryRows, error: mError }] = await Promise.all([nationalQuery, ministryQuery])
        if (nError) console.error('[RAG] financial_facts national analysis query error:', JSON.stringify(nError))
        if (mError) console.error('[RAG] financial_facts ministry analysis query error:', JSON.stringify(mError))
        analysisFacts = [...(nationalRows ?? []), ...(ministryRows ?? [])]
          .filter(f => !(f.flags as string[] | null)?.length) as FactRow[]
      }

      // financial_facts.value/unit is the RAW figure as printed in the
      // table (e.g. value=16097003.38, unit='million' for a cell that's
      // actually GH¢16.1 million) — value_millions is the corrected
      // figure already converted to GH¢ millions. Showing raw `value`
      // alongside `unit` led the model to read e.g. "16097003.38 million"
      // literally (off by ~10^6). Always present value_millions (when
      // available) labeled "GH¢ million" instead.
      const display = (f: { value: number; unit: string; value_millions: number | null }) =>
        f.value_millions != null
          ? { value: f.value_millions, unit: 'GH¢ million' }
          : { value: f.value, unit: f.unit }

      // No budget-specific facts at all — likely a non-budget tenant or
      // document. Check document_facts (the generic extraction fallback,
      // see genericFactExtraction.ts) before giving up — scoped to the
      // documents the chunk retrieval already found relevant for this
      // query, so a tenant with several non-budget documents doesn't get
      // unrelated facts from one document mixed into another's answer.
      // Queried here (rather than inline below) so its document_ids can be
      // folded into factDocIds before factDocsPromise fires.
      let docFacts: { id: string; document_id: string; category: string | null; subject: string | null; attribute: string | null; value_text: string; unit: string | null; page_number: number | null; section_title: string | null; confidence: number }[] = []
      if (!validFacts.length && !flaggedFacts.length) {
        const docIds = [...new Set(chunks.map(c => c.document_id).filter(Boolean))]
        if (docIds.length) {
          const { data, error: docFactsError } = await svc
            .from('document_facts')
            .select('id, document_id, category, subject, attribute, value_text, unit, page_number, section_title, confidence')
            .eq('tenant_id', tenantId)
            .in('document_id', docIds)
            .gte('confidence', 70)
            .limit(50)
          if (docFactsError) console.error('[RAG] document_facts query error:', JSON.stringify(docFactsError))
          docFacts = data ?? []
        }
      }

      // Cap how many facts get their own synthetic citation to keep the
      // citation list manageable. 50 covers the full 1999-2026 national
      // total_budget series (28 years) plus headroom — previously 20 left
      // later years of multi-decade series without a [n] citation, which led
      // the model to substitute an uncited (and sometimes wrong) figure for
      // those years.
      const citedFacts = validFacts.slice(0, 50)
      const factDocIds = new Set([...citedFacts, ...analysisFacts].map(f => f.document_id).concat(docFacts.map(f => f.document_id)).filter(Boolean))
      factDocsPromise = factDocIds.size
        ? svc.from('documents').select('id, title').in('id', [...factDocIds])
        : Promise.resolve({ data: [] as { id: string; title: string }[] })

      let nextCitation = chunks.length + 1
      // Adds a synthetic [n] citation for a fact used in an analysis block
      // (cumulative/ranking/proportion/trend/deviation/forecast), and feeds
      // it into verifyAnswer() so its figure is recognized as supported.
      const citeFact = (f: FactRow): number => {
        const n = nextCitation++
        const d = display(f)
        factCitations.push({
          id: `fact-${f.document_id}-${f.fiscal_year}-${f.metric}-${f.entity}-${n}`,
          document_chunk_id: null,
          document_id: f.document_id,
          document_title: 'Document',
          chunk_text: `${f.entity} — ${f.metric.replace(/_/g, ' ')} (${f.fiscal_year ?? '—'}): ${d.value} ${d.unit}`
            + (f.section_title ? ` — ${f.section_title}` : ''),
          relevance_score: f.confidence / 100,
          highlight: null,
          page_number: f.page_number,
          section_title: f.section_title,
        })
        validatedFactsForVerification.push({ value_millions: f.value_millions })
        return n
      }

      if (validFacts.length || flaggedFacts.length) {
        const lines = [
          'VALIDATED FACTS (from financial_facts store — pre-verified, use these exact values; cite each row with its own [n] marker shown in the Source column; do not recompute or alter them):',
          '| Year | Entity | Metric | Value | Unit | Confidence | Source |',
          ...citedFacts.map(f => {
            const n = nextCitation++
            const d = display(f)
            factCitations.push({
              id: `fact-${f.document_id}-${f.fiscal_year}-${f.metric}-${n}`,
              document_chunk_id: null,
              document_id: f.document_id,
              document_title: 'Document',
              chunk_text: `${f.entity} — ${f.metric.replace(/_/g, ' ')} (${f.fiscal_year ?? '—'}): ${d.value} ${d.unit}`
                + (f.section_title ? ` — ${f.section_title}` : ''),
              relevance_score: f.confidence / 100,
              highlight: null,
              page_number: f.page_number,
              section_title: f.section_title,
            })
            return `| ${f.fiscal_year ?? '—'} | ${f.entity} | ${f.metric} | ${d.value} | ${d.unit} | ${f.confidence}% | [${n}] |`
          }),
          ...validFacts.slice(citedFacts.length).map(f => {
            const d = display(f)
            return `| ${f.fiscal_year ?? '—'} | ${f.entity} | ${f.metric} | ${d.value} | ${d.unit} | ${f.confidence}% | — |`
          }),
        ]
        if (flaggedFacts.length) {
          lines.push('\nFLAGGED — DO NOT USE as fact (data quality issues detected):')
          lines.push(...flaggedFacts.map(f => {
            const d = display(f)
            return `- ${f.fiscal_year ?? '—'} ${f.entity} ${f.metric} = ${d.value} ${d.unit} (${(f.flags as string[]).join(', ')})`
          }))
        }
        factsBlock = '\n\n' + lines.join('\n')
      } else {
        if (docFacts.length) {
          const lines = [
            'EXTRACTED FACTS (from document_facts store — verified data points; cite each row with its own [n] marker):',
            '| Subject | Attribute | Value | Source |',
            ...docFacts.map(f => {
              const n = nextCitation++
              const valueDisplay = f.unit ? `${f.value_text} ${f.unit}` : f.value_text
              factCitations.push({
                id: `docfact-${f.id}`,
                document_chunk_id: null,
                document_id: f.document_id,
                document_title: 'Document',
                chunk_text: `${f.subject} — ${f.attribute}: ${valueDisplay}` + (f.section_title ? ` — ${f.section_title}` : ''),
                relevance_score: f.confidence / 100,
                highlight: null,
                page_number: f.page_number,
                section_title: f.section_title,
              })
              return `| ${f.subject} | ${f.attribute} | ${valueDisplay} | [${n}] |`
            }),
          ]
          factsBlock = '\n\n' + lines.join('\n')
        } else {
          factsBlock = '\n\nVALIDATED FACTS: No validated facts found for the requested year/entity. ' +
            "If the excerpts below also don't clearly support a confident figure, respond with the standard insufficient-evidence message."
        }
      }

      // ── Analytical blocks (cumulative / ranking / proportion / trend /
      //    deviation / forecast) — each appended as its own labeled block
      //    that the SYSTEM_PROMPT instructs the model to use verbatim. ──
      const analysisLines: string[] = []
      const range = relativeRange ?? (years.length
        ? { from: Math.min(...years.map(Number)), to: Math.max(...years.map(Number)) }
        : null)

      // Finds the entity_type/canonical entity name for a sector/ministry
      // mentioned by name (e.g. entityHint = "Health" or "Ministry of
      // Education") within the broader analysisFacts dataset.
      const findEntity = (hint: string): { entityType: 'ministry' | 'sector'; entity: string } | null => {
        const needle = hint.toLowerCase()
        const match = analysisFacts.find(f =>
          (f.entity_type === 'ministry' || f.entity_type === 'sector') &&
          canonicalizeEntity(f.entity).toLowerCase().includes(needle))
        return match ? { entityType: match.entity_type as 'ministry' | 'sector', entity: match.entity } : null
      }

      if (wantsCumulative && range) {
        const found = entityHint && entityHint !== 'National' ? findEntity(entityHint) : null
        const cumEntityType = found?.entityType ?? (/\bsectors?\b/i.test(query) ? 'sector' : 'ministry')
        const entries = cumulativeByEntity(analysisFacts, { entityType: cumEntityType, metric: 'allocation', from: range.from, to: range.to }, 5)
        if (entries.length) {
          analysisLines.push(`CUMULATIVE ALLOCATION ${range.from}-${range.to} (sum of validated yearly figures per entity):`)
          analysisLines.push('| Entity | Total (GH¢ million) | Years covered | Source |')
          for (const e of entries) {
            const n = citeFact(e.facts[0])
            // The cumulative TOTAL is a sum the model will quote verbatim,
            // but it doesn't equal any single financial_facts row's
            // value_millions — without registering it here, verifyAnswer()
            // can't find it anywhere and marks it "unsupported", capping
            // confidence at 60.
            validatedFactsForVerification.push({ value_millions: e.total })
            analysisLines.push(`| ${e.entity} | ${e.total.toLocaleString()} | ${e.coverage} | [${n}] |`)
          }
        } else {
          analysisLines.push(`CUMULATIVE ALLOCATION ${range.from}-${range.to}: No validated ministry/sector allocation facts found for this range — cannot compute a cumulative ranking.`)
        }
      }

      if (wantsRanking && range) {
        const rankEntityType: 'ministry' | 'sector' = /\bsectors?\b/i.test(query) ? 'sector' : 'ministry'
        const nMatch = query.match(/top\s+(five|5|three|3|ten|10|\d+)/i)
        const wordN: Record<string, number> = { five: 5, three: 3, ten: 10 }
        const topN = nMatch ? (wordN[nMatch[1].toLowerCase()] ?? parseInt(nMatch[1], 10) ?? 5) : 5
        const entries = topNGrowth(analysisFacts, { entityType: rankEntityType, metric: 'allocation', from: range.from, to: range.to }, topN)
        if (entries.length) {
          analysisLines.push(`TOP ${topN} BY % GROWTH ${range.from}-${range.to} (based on each entity's earliest and latest validated figures within this range):`)
          analysisLines.push('| Entity | From | To | Change | Source |')
          for (const e of entries) {
            const n1 = citeFact(e.fromFact)
            const n2 = citeFact(e.toFact)
            analysisLines.push(`| ${e.entity} | ${e.fromYear}: ${e.fromValue} | ${e.toYear}: ${e.toValue} | ${e.growthPct > 0 ? '+' : ''}${e.growthPct}% | [${n1}][${n2}] |`)
          }
        } else {
          analysisLines.push(`TOP GROWTH ${range.from}-${range.to}: No entities have validated allocation figures at two or more points in this range — cannot compute a growth ranking.`)
        }
      }

      if (wantsProportion) {
        const yearMatch = query.match(/\b(19|20)\d{2}\b/)
        const found = entityHint && entityHint !== 'National' ? findEntity(entityHint) : null
        if (yearMatch && found) {
          const year = parseInt(yearMatch[0], 10)
          const propRange = range ?? { from: year - 5, to: year + 5 }
          const result = proportionOfTotal(analysisFacts, { entity: found.entity, entityType: found.entityType, metric: 'allocation', year, range: propRange })
          if (result) {
            const n1 = citeFact(result.current.entityFact)
            const n2 = citeFact(result.current.nationalFact)
            analysisLines.push(`PROPORTION OF TOTAL BUDGET — ${canonicalizeEntity(found.entity)} ${year}: ${result.current.proportionPct}% (${result.current.entityFact.value_millions} of ${result.current.nationalFact.value_millions} GH¢ million) [${n1}][${n2}]`)
            if (result.history.length) {
              analysisLines.push('| Year | Proportion | Source |')
              for (const h of result.history) {
                const n3 = citeFact(h.entityFact)
                const n4 = citeFact(h.nationalFact)
                analysisLines.push(`| ${h.year} | ${h.proportionPct}% | [${n3}][${n4}] |`)
              }
            } else {
              analysisLines.push('No validated proportion data available for comparison years in this range.')
            }
          } else {
            analysisLines.push(`PROPORTION OF TOTAL BUDGET — ${canonicalizeEntity(found.entity)} ${year}: No validated figures found for both this entity and the national total in ${year}.`)
          }
        }
      }

      if (wantsSummary && range) {
        const found = entityHint && entityHint !== 'National' ? findEntity(entityHint) : null
        const sumEntityType = found?.entityType ?? 'national'
        const sumEntity = found?.entity ?? 'National'
        const sumMetric = found ? 'allocation' : 'total_budget'
        const trend = summarizeTrend(analysisFacts, { entityType: sumEntityType, entity: sumEntity, metric: sumMetric, from: range.from, to: range.to })
        if (trend) {
          const n1 = citeFact(trend.firstFact)
          const n2 = citeFact(trend.lastFact)
          analysisLines.push(`TREND SUMMARY — ${trend.entity} ${trend.metric.replace(/_/g, ' ')} ${trend.from}-${trend.to} (${trend.yearsCovered} of ${trend.rangeSize} years covered):`)
          analysisLines.push(`- Overall change: ${trend.totalChangePct != null ? `${trend.totalChangePct > 0 ? '+' : ''}${trend.totalChangePct}%` : 'not computable'} from ${trend.firstFact.fiscal_year} to ${trend.lastFact.fiscal_year} [${n1}][${n2}]`)
          if (trend.avgYoYPct != null) analysisLines.push(`- Average year-over-year change: ${trend.avgYoYPct > 0 ? '+' : ''}${trend.avgYoYPct}%`)
          if (trend.maxChange) analysisLines.push(`- Largest single-year increase: ${trend.maxChange.pct > 0 ? '+' : ''}${trend.maxChange.pct}% in ${trend.maxChange.year}`)
          if (trend.minChange) analysisLines.push(`- Largest single-year decrease: ${trend.minChange.pct > 0 ? '+' : ''}${trend.minChange.pct}% in ${trend.minChange.year}`)
          if (trend.yearsCovered < trend.rangeSize) analysisLines.push(`- NOTE: only ${trend.yearsCovered} of ${trend.rangeSize} years in this range have validated figures — treat this as a partial trend, not the full ${trend.rangeSize}-year period.`)

          const series = yoySeries(analysisFacts, { entityType: sumEntityType, entity: sumEntity, metric: sumMetric })
            .filter(p => p.year >= range.from && p.year <= range.to)
          if (series.length >= 2) {
            chartData = {
              title: `${trend.entity} ${trend.metric.replace(/_/g, ' ')} (${trend.from}-${trend.to})`,
              unit: 'GH¢ million',
              series: series.map(p => ({ year: p.year, value: p.value })),
            }
          }
        } else {
          analysisLines.push(`TREND SUMMARY — ${canonicalizeEntity(sumEntity)} ${sumMetric.replace(/_/g, ' ')} ${range.from}-${range.to}: Fewer than 2 validated figures found — cannot summarize a trend.`)
        }
      }

      // Second-entity trend for comparison queries (e.g. Q8: "compare
      // allocations to infrastructure and education over the last decade").
      // Produces a second TREND SUMMARY block so the model can present both
      // entities side-by-side without recomputing the numbers itself.
      if (secondEntityHint && range && (queryType === 'comparison' || wantsSummary)) {
        const found2 = findEntity(secondEntityHint)
        if (found2) {
          const trend2 = summarizeTrend(analysisFacts, { entityType: found2.entityType, entity: found2.entity, metric: 'allocation', from: range.from, to: range.to })
          if (trend2) {
            const n1 = citeFact(trend2.firstFact)
            const n2 = citeFact(trend2.lastFact)
            analysisLines.push(`TREND SUMMARY — ${trend2.entity} allocation ${trend2.from}-${trend2.to} (${trend2.yearsCovered} of ${trend2.rangeSize} years covered):`)
            analysisLines.push(`- Overall change: ${trend2.totalChangePct != null ? `${trend2.totalChangePct > 0 ? '+' : ''}${trend2.totalChangePct}%` : 'not computable'} from ${trend2.firstFact.fiscal_year} to ${trend2.lastFact.fiscal_year} [${n1}][${n2}]`)
            if (trend2.avgYoYPct != null) analysisLines.push(`- Average year-over-year change: ${trend2.avgYoYPct > 0 ? '+' : ''}${trend2.avgYoYPct}%`)
            if (trend2.maxChange) analysisLines.push(`- Largest single-year increase: ${trend2.maxChange.pct > 0 ? '+' : ''}${trend2.maxChange.pct}% in ${trend2.maxChange.year}`)
            if (trend2.minChange) analysisLines.push(`- Largest single-year decrease: ${trend2.minChange.pct > 0 ? '+' : ''}${trend2.minChange.pct}% in ${trend2.minChange.year}`)
            if (trend2.yearsCovered < trend2.rangeSize) analysisLines.push(`- NOTE: only ${trend2.yearsCovered} of ${trend2.rangeSize} years in this range have validated figures.`)
          } else {
            analysisLines.push(`TREND SUMMARY — ${secondEntityHint} allocation ${range.from}-${range.to}: Fewer than 2 validated figures found — cannot summarize.`)
          }
        }
      }

      if (queryType === 'anomaly_detection') {
        const found = entityHint && entityHint !== 'National' ? findEntity(entityHint) : null
        const devEntityType = found?.entityType ?? 'national'
        const devMetric = /capital expenditure/i.test(query)
          ? 'capital_expenditure'
          : (found ? 'allocation' : 'total_budget')
        const deviations = detectDeviations(analysisFacts, { entityType: devEntityType, entity: found?.entity, metric: devMetric })
        if (deviations.length) {
          analysisLines.push(`DEVIATION DETECTION — ${devMetric.replace(/_/g, ' ')}${found ? ` (${canonicalizeEntity(found.entity)})` : ''} (years whose value is more than 2x or less than half the surrounding years' median):`)
          for (const d of deviations) {
            const n = citeFact(d.fact)
            analysisLines.push(`- ${d.year}: ${d.value} GH¢ million vs. neighboring median ${d.medianBaseline} GH¢ million (${d.deviationPct > 0 ? '+' : ''}${d.deviationPct}%) [${n}]`)
          }
        }
      }

      if (queryType === 'forecast' && entityHint && entityHint !== 'National') {
        const found = findEntity(entityHint)
        if (found) {
          const forecast = forecastNextYear(analysisFacts, { entityType: found.entityType, entity: found.entity, metric: 'allocation' })
          if (forecast) {
            const ns = forecast.facts.map(f => citeFact(f))
            analysisLines.push(`PRE-COMPUTED FORECAST FROM VALIDATED FACTS — ${canonicalizeEntity(found.entity)} allocation:`)
            analysisLines.push(`- Based on ${forecast.baseYears.join(', ')} (${forecast.baseValues.join(', ')} GH¢ million), projected ${forecast.forecastYears[0]}: ~${forecast.forecastValues[0]} GH¢ million ${ns.map(n => `[${n}]`).join('')}`)
            analysisLines.push(`- Multi-year outlook (ESTIMATES): ${forecast.forecastYears.map((y, i) => `${y} ~${forecast.forecastValues[i]}`).join(', ')} GH¢ million`)

            chartData = {
              title: `${canonicalizeEntity(found.entity)} allocation — historical & projected`,
              unit: 'GH¢ million',
              series: [
                ...forecast.baseYears.map((y, i) => ({ year: y, value: forecast.baseValues[i] })),
                ...forecast.forecastYears.map((y, i) => ({ year: y, value: forecast.forecastValues[i], projected: true })),
              ],
            }
          }
        }
      }

      if (analysisLines.length) factsBlock += '\n\n' + analysisLines.join('\n')
    }

    /* ── 3. Prefetch citation titles via service role ────────── */
    const chunkDetailsPromise = svc
      .from('document_chunks').select('id, documents(title)')
      .in('id', chunks.map(c => c.id))

    /* ── 4. Pre-generate conversation ID so we can include in done event ── */
    const title  = makeTitle(query)

    // Only attach the financial-rules addendum when there's actually
    // PRE-COMPUTED/VALIDATED FACTS content in the prompt for it to govern —
    // keeps the prompt lean (faster, fewer tokens) for general documents.
    const hasFinancialContext = calcBlock.length > 0 || factsBlock.length > 0
    const systemPrompt = coreSystemPrompt(orgName, orgDescription) + (hasFinancialContext ? FINANCIAL_SYSTEM_PROMPT_ADDENDUM : '')

    /* ── 5. Stream from Claude ──────────────────────────────── */
    // Large multi-document ("deep search") prompts can push this single
    // request's input tokens close to the org's 10,000 input-tokens/min
    // limit — combined with prior turns in the same minute, this can trip a
    // transient 429 even though the account has plenty of credit (rate
    // limits are a per-minute throughput cap, independent of balance).
    // Retry a couple of times with backoff before giving up.
    const claudeBody = JSON.stringify({
      model: CLAUDE_MODEL, temperature: 0.2, max_tokens: isDeepSearch ? 1600 : 800, stream: true,
      system: systemPrompt,
      messages: [
        ...historyMsgs,
        { role: 'user', content: `${inventoryText}\n\nDOCUMENT EXCERPTS FROM SEARCH:\n${context}${calcBlock}${factsBlock}${guidanceBlock}\n\nQuestion: ${query}` },
      ],
    })

    let claudeRes: Response
    let claudeErrText = ''
    const MAX_CLAUDE_ATTEMPTS = 3
    for (let attempt = 1; attempt <= MAX_CLAUDE_ATTEMPTS; attempt++) {
      claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: getAnthropicHeaders(), body: claudeBody, signal: request.signal,
      })
      if (claudeRes.ok && claudeRes.body) break
      claudeErrText = await claudeRes.text().catch(() => '')
      console.error('[RAG] Claude API error:', claudeRes.status, claudeErrText, `(attempt ${attempt}/${MAX_CLAUDE_ATTEMPTS})`)
      if (claudeRes.status !== 429 || attempt === MAX_CLAUDE_ATTEMPTS) break
      const retryAfter = Number(claudeRes.headers.get('retry-after'))
      await new Promise(r => setTimeout(r, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : attempt) * 1000))
    }

    if (!claudeRes!.ok || !claudeRes!.body) {
      const msg = claudeRes!.status === 429
        ? 'The AI service is temporarily busy (rate limit reached). Please wait a few seconds and try again.'
        : 'Failed to generate a response. Please try again.'
      return new Response(msg, { status: 502 })
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader  = claudeRes.body!.getReader()
        const decoder = new TextDecoder()
        let fullText  = ''
        let buf       = ''

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buf += decoder.decode(value, { stream: true })
            const lines = buf.split('\n')
            buf = lines.pop() ?? ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const raw = line.slice(6).trim()
              if (!raw) continue
              let parsed: { type?: string; delta?: { type?: string; text?: string } }
              try { parsed = JSON.parse(raw) } catch { continue }
              if (parsed.type !== 'content_block_delta' || parsed.delta?.type !== 'text_delta') continue
              const token = parsed.delta.text ?? ''
              if (!token) continue
              fullText += token
              controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: token })}\n\n`))
            }
          }

          const parsed = parseDelimited(fullText)

          // Citation numbers [n] the model actually referenced in the final
          // answer — used below to limit the Source Viewer and persisted
          // `citations` rows to evidence the answer genuinely drew from.
          // Without this, EVERY retrieved chunk/fact became a citation
          // regardless of use, including low-relevance chunks the reranker
          // only included to pad out the top 10 (e.g. a stray budget-document
          // chunk surfacing as a "source" on a question entirely about an
          // unrelated contract). The frontend resolves [n] markers by ARRAY
          // POSITION (citations[n-1] — see MessageContent.tsx), so dropping
          // unused entries requires renumbering every surviving marker to a
          // compact 1..N sequence, not just filtering the array. verifyAnswer
          // below still checks the answer's numbers against the FULL
          // `chunks`/retrieval set, not just the cited subset — citing a
          // figure isn't a precondition for it being genuinely supported by
          // the retrieved evidence.
          const citedIndices = new Set(
            [parsed.answer, ...parsed.risks, ...parsed.recommendations].join(' ').match(/\[(\d+)\]/g)
              ?.map(m => parseInt(m.slice(1, -1), 10)) ?? []
          )
          const sortedUsed = [...citedIndices].sort((a, b) => a - b)
          const renumberMap = new Map(sortedUsed.map((old, i) => [old, i + 1]))
          const renumber = (text: string) => text.replace(/\[(\d+)\]/g, (m, numStr) => {
            const newNum = renumberMap.get(parseInt(numStr, 10))
            return newNum != null ? `[${newNum}]` : m
          })
          const answer = renumber(parsed.answer)
          const risks = parsed.risks.map(renumber)
          const recommendations = parsed.recommendations.map(renumber)
          const citedChunks = sortedUsed.filter(n => n <= chunks.length).map(n => chunks[n - 1])
          const citedFactCitations = sortedUsed.filter(n => n > chunks.length).map(n => factCitations[n - chunks.length - 1])

          /* ── Answer verification + confidence scoring ──────────
             Deterministic second pass: every non-percentage figure in the
             answer should appear in the retrieved chunks, and any "+X%"
             growth claim should match the actual change between the two
             cited figures. Combined with retrieval quality, this replaces
             the old hardcoded 0.85 confidence score. */
          // factCitations' own relevance_score (the underlying fact's
          // extraction confidence — see citeFact()/the EXTRACTED FACTS block
          // above) belongs in this average alongside raw chunk similarity.
          // Without it, an answer grounded entirely by cited financial_facts/
          // document_facts rows (little or no real overlap with the actual
          // retrieved chunks, e.g. a short non-budget document) was scored
          // purely on chunk-retrieval quality — which can be coincidentally
          // low for a small/sparse document even when the answer is fully
          // correct and explicitly cites a verified, extracted fact.
          const retrievalScores = [
            ...chunks.map(c => c.rerank_score ?? c.similarity ?? c.rrf_score ?? 0),
            ...factCitations.map(fc => fc.relevance_score),
          ]
          const verification = verifyAnswer(answer, chunks, retrievalScores, validatedFactsForVerification)

          // The answer itself explicitly says the literal question can't be
          // fully answered from the available evidence (e.g. "does not
          // contain a consolidated...", "cannot be reliably produced", "No
          // validated facts found") and offers supplementary data instead.
          // Per the "Insufficient context" rule, this is the CORRECT, honest
          // response — don't pile the harsh AI-verifier penalty or the
          // "treat as unreliable" banner on top of an answer that already
          // disclosed its own limits.
          const isHonestInsufficiency = /\b(insufficient evidence|cannot (?:be )?(?:reliably |responsibly )?(?:computed|produced|determined|calculated|constructed|derived|established|summarized|compute|produce|determine|calculate|construct|derive|establish|summarize)|no validated [\w\s/-]{0,40}?(?:facts|figures|allocations?|data)|does not contain (?:a )?(?:consolidated|sufficient)|not (?:enough|sufficient) (?:data|information|evidence))\b/i.test(answer)
          if (isHonestInsufficiency) {
            // An answer that admits the requested figure/trend/computation
            // couldn't be validated is by definition partial/hedged — per the
            // HONEST INSUFFICIENCY invariant such answers get Medium
            // confidence, even if the supplementary figures it DID cite are
            // all well-supported (which would otherwise push the score into
            // "High"). Floor of 20 keeps it out of the "very low" no-answer
            // tier; cap of 74 keeps it out of "High".
            verification.confidenceScore = Math.max(20, Math.min(74, verification.confidenceScore))
            verification.confidenceLevel =
              verification.confidenceScore >= 75 ? 'High' : verification.confidenceScore >= 50 ? 'Medium' : 'Low'
          }
          if (verification.unsupported.length) {
            console.log('[RAG] unsupported figures in answer:', verification.unsupported)
          }
          if (verification.growthChecks.some(g => !g.ok)) {
            console.log('[RAG] growth claim mismatches:', verification.growthChecks.filter(g => !g.ok))
          }

          /* ── AI second-pass verification ───────────────────────
             Ask gpt-4o-mini to check the answer's claims against VALIDATED
             FACTS (if any) + the excerpts. Any issues are surfaced as risks
             and reduce the confidence score. Runs for all query types so
             non-financial answers also get this check. */
          try {
            const { issues } = await verifyAnswerWithAI({
              query, answer, factsBlock, context, signal: request.signal,
            })
            if (issues.length) {
              console.log('[RAG] AI verifier issues:', issues)
              risks.push(...issues)
              // Cap the total deduction so a handful of minor issues can't
              // crater the score to near-zero on an otherwise well-supported
              // answer — each issue still costs 15 points, up to 2 issues' worth.
              // An answer that already admits it couldn't fully answer the
              // question gets a much lighter penalty — verifier nitpicks on
              // its supplementary data aren't the headline concern.
              const penalty = isHonestInsufficiency ? Math.min(10, 5 * issues.length) : Math.min(30, 15 * issues.length)
              const floor = isHonestInsufficiency ? 20 : 1
              verification.confidenceScore = Math.max(floor, verification.confidenceScore - penalty)
              verification.confidenceLevel =
                verification.confidenceScore >= 75 ? 'High' : verification.confidenceScore >= 50 ? 'Medium' : 'Low'
            }
          } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') throw e
          }

          /* ── Inventory-question confidence override ────────────
             "Do we have any files about X?" / "what files exist?" type
             questions are answered from the KNOWLEDGE BASE INVENTORY block
             (always present in context, see inventoryText above), not from
             the retrieved chunks' content — so the chunk-retrieval-quality
             component of verifyAnswer() is irrelevant here and shouldn't
             drag down an answer that's actually a confident, correct
             statement about what's in the system. */
          if (INVENTORY_QUERY_RX.test(query)) {
            verification.confidenceScore = 95
            verification.confidenceLevel = 'High'
          }

          /* ── No-Answer tier ─────────────────────────────────────
             If most of the answer's own figures couldn't be matched against
             the source chunks or VALIDATED FACTS, confidence collapses to
             "Low" — surface this loudly as a risk rather than presenting an
             apparently normal answer with a quietly poor score. */
          if (
            !INVENTORY_QUERY_RX.test(query) &&
            !isHonestInsufficiency &&
            verification.totalNumbers > 0 &&
            verification.confidenceScore < 25
          ) {
            risks.unshift(
              'Confidence is very low — most figures in this answer could not be verified against the source documents or validated facts. Treat this answer as unreliable and verify the underlying documents manually.'
            )
            verification.confidenceLevel = 'Low'
          }

          let convId: string | null = null
          if (newSession) {
            try {
              const messages = [
                { role: 'user', text: query },
                { role: 'ai',   text: answer, risks, recommendations },
              ]
              const { data: conv, error: convErr } = await supabase
                .from('conversations')
                .insert({
                  user_id: user!.id, tenant_id: tenantId,
                  query, response: answer, confidence_score: verification.confidenceScore / 100, risks, recommendations,
                  messages,
                })
                .select('id')
                .single()
              if (convErr) console.error('Conv save error:', convErr.message)
              convId = conv?.id ?? null
              if (convId && (citedChunks.length || citedFactCitations.length)) {
                const { error: citationsErr } = await svc.from('citations').insert([
                  ...citedChunks.map(c => ({
                    conversation_id: convId, document_chunk_id: c.id, relevance_score: c.similarity,
                    message_index: rawHistoryLength + 1,
                  })),
                  ...factCitationRows(convId, citedFactCitations, rawHistoryLength + 1),
                ])
                if (citationsErr) console.error('[RAG] citations insert failed:', citationsErr)
              }
            } catch (e) { console.error('Save failed:', e) }
          } else if (existingConvId) {
            convId = existingConvId
            await appendConv(existingConvId, answer, risks, recommendations)
            if (citedChunks.length || citedFactCitations.length) {
              const { error: citationsErr } = await svc.from('citations').insert([
                ...citedChunks.map(c => ({
                  conversation_id: convId, document_chunk_id: c.id, relevance_score: c.similarity,
                  message_index: rawHistoryLength + 1,
                })),
                ...factCitationRows(convId, citedFactCitations, rawHistoryLength + 1),
              ])
              if (citationsErr) console.error('[RAG] citations insert failed:', citationsErr)
            }
          }

          // Build citation objects with the real DB-generated convId
          const [{ data: chunkDetails }, { data: factDocs }] = await Promise.all([chunkDetailsPromise, factDocsPromise])
          if (factCitations.length) {
            const docTitleById = new Map((factDocs ?? []).map(d => [d.id, d.title]))
            for (const fc of factCitations) {
              fc.document_title = docTitleById.get(fc.document_id) ?? 'Document'
            }
          }
          const chunkCitations = citedChunks.map(c => {
            const detail  = chunkDetails?.find(d => d.id === c.id)
            const rawDocs = detail?.documents as { title: string } | { title: string }[] | null
            const docTitle = Array.isArray(rawDocs) ? rawDocs[0]?.title : rawDocs?.title
            const meta = c.metadata ?? {}
            return {
              id: c.id, conversation_id: convId ?? '',
              document_chunk_id: c.id as string | null,
              document_id: c.document_id,
              document_title: docTitle ?? 'Document',
              chunk_text: c.chunk_text,
              relevance_score: c.similarity,
              highlight: findHighlightSpan(c.chunk_text, query),
              page_number: (meta.page_number as number | null) ?? null,
              section_title: (meta.section_title as string | null) ?? null,
            }
          })
          // VALIDATED FACTS rows cited via synthetic [n] markers (see
          // factCitations above) — not backed by a document_chunk_id, but
          // persisted via factCitationRows() (migration 017) so they remain
          // resolvable after the conversation is reloaded from history.
          const citations = [
            ...chunkCitations,
            ...citedFactCitations.map(f => ({ ...f, conversation_id: convId ?? '' })),
          ]

          controller.enqueue(enc.encode(
            `data: ${JSON.stringify({
              done: true, answer, risks, recommendations, citations, chart: chartData,
              confidence_score: verification.confidenceScore,
              confidence_level: verification.confidenceLevel,
              convId, title,
            })}\n\n`
          ))

        } catch (err) {
          if ((err as Error).name !== 'AbortError') console.error('Stream error:', err)
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, { headers: sseHeaders() })

  } catch (err) {
    console.error('Chat API error:', err)
    return new Response('Internal server error', { status: 500 })
  }
}
