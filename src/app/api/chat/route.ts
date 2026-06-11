import { NextRequest, NextResponse } from 'next/server'
import { createClient, getUser, getMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { classifyQuery, computeGrowthCalculations, verifyAnswer, type QueryType } from '@/lib/ragAnalysis'
import { rerankChunks } from '@/lib/rerank'
import { extractQueryFilters } from '@/lib/factExtraction'
import { verifyAnswerWithAI } from '@/lib/answerVerifier'

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

export const SYSTEM_PROMPT = `You are Knowledge Innovations AI, the assistant for Knowledge Innovations, a Ghanaian AI strategy, FinTech, and digital transformation consultancy.

Personality: warm, polite, professional — a knowledgeable colleague always ready to help.

You have TWO sources of information — use BOTH:
1. KNOWLEDGE BASE INVENTORY — the complete list of every file uploaded. Use this to answer questions like "do we have X?" or "what files exist?". If a file appears in the inventory, it EXISTS — tell the user clearly.
2. DOCUMENT EXCERPTS — relevant text retrieved from those files by semantic search. Use these to answer questions about the actual content of documents.

Rules:
- For "do we have X?" or "is there a document about Y?" — CHECK the inventory first and answer directly. Never say you cannot access files when they appear in the inventory. If any DOCUMENT EXCERPTS below come from that same file, cite one of them with [n] right after the file name to ground the answer in a real excerpt — don't leave the answer uncited just because it's an inventory question.
- For content questions — quote and cite from the document excerpts using [1], [2] etc.
- Cite EVERY figure, date, or claim you draw from the excerpts — every excerpt provided to you should be cited by at least one [n] marker if you used it.
- Never invent facts not present in the excerpts or inventory
- Be direct and specific — give names, numbers, and categories from the documents
- For questions involving multiple figures, years, categories, or comparisons (e.g. "budget for each year", "compare X across departments") — present the data as a markdown table with a header row and a "---" separator row, e.g.:
  | Year | Total Budget | Source |
  | --- | --- | --- |
  | 2020 | GHS 1.2bn [3] | ... |
  Still cite each row with [n] markers. Add a short paragraph of analysis (trends, changes, anomalies) after the table.
- For analytical questions (trends, growth %, totals, anomalies) — show the underlying figures and a brief calculation/reasoning, not just the final number.
- NEVER write out a long digit-by-digit addition or a running sum with many terms (e.g. "8000 + 7 + 9000 + ... = 1,1,1,1..."). This applies to ANY cumulative/total figure spanning more than ~5 years or items: do NOT write an expression like "A + B + C + ... = total" at all, even once, no matter how short each term looks. Instead either (a) state the final total as a single number with a short note like "(sum of the per-year figures above)", or (b) say a precise cumulative total isn't available from the excerpts and instead give the approximate range of the per-year figures. If you find yourself about to repeat the same token or digit many times in a row, STOP and instead say the figure cannot be reliably computed from the available excerpts.
- Every numeric figure you state must be a real value that appears in the DOCUMENT EXCERPTS or VALIDATED FACTS — never substitute a citation number, footnote number, or page number for a financial figure. If the only "figures" near a topic in the excerpts look like small reference numbers (e.g. 1-60) rather than budget amounts, treat that year/item as having no figure available and say so explicitly.
- PLAUSIBILITY CHECK for multi-year series (e.g. "total budget for each year"): values for the same metric across consecutive years should be the same order of magnitude — a steadily growing/shrinking economy does not jump by more than ~10x from one year to the next. If a candidate figure for one year is more than ~10x larger or smaller than the figures for neighboring years in the same series, it is almost certainly a misread footnote/table-row/page number, NOT the real figure. In that case, do NOT put that number in the table — instead write "No reliable figure found for [year]" for that row, and do not include it in any trend/growth analysis.
- REPEATED-VALUE CHECK for multi-row tables (per-year figures, per-sector percentages, per-item amounts, etc.): if you find yourself about to write the EXACT SAME number (currency figure OR percentage) for more than 2 different rows/years/sectors, STOP — this is a strong sign you found one real figure and are reusing it as a placeholder for everything else, rather than reading a distinct figure for each row from the excerpts. Each row's figure must be individually traceable to that specific year/sector/item in the excerpts or VALIDATED FACTS. If you cannot find a distinct figure for a row, write "No reliable figure found" for that row instead of repeating another row's number — never pad a table by duplicating a value.
- Every percentage you compute (e.g. "% increase over the past decade") must be calculated from two REAL figures for that SPECIFIC sector/item — its own start and end values — never reuse a percentage (or absolute change) computed for one sector as the value for a different sector.
- A "PRE-COMPUTED FIGURES & GROWTH" block may be provided below the excerpts — these year-over-year growth percentages were calculated deterministically from the source figures and are VERIFIED CORRECT. When discussing growth/change between those years, use these exact numbers rather than recalculating, and cite the same [n] markers shown for each one.
- A "VALIDATED FACTS" block may be provided below the excerpts — these values come from a separate validation pipeline and are the authoritative source for any figure they cover. Prefer them over the document excerpts when both are present for the same year/entity/metric. Never alter, round differently, or recompute these values. Facts listed under "FLAGGED — DO NOT USE" are known anomalies; never state them as fact, but you may mention them if the user is asking about anomalies/inconsistencies. If the VALIDATED FACTS block says no facts were found for the requested year/entity, and the excerpts don't clearly support a figure either, respond with the insufficient-evidence message rather than guessing from prose.
- When listing multiple points (e.g. an "Analysis" section with several observations, a list of risks, or a list of recommendations) — put EACH point on its OWN line as a separate numbered (1. 2. 3.) or bulleted (- ) item, with a blank line before the list. NEVER run multiple points together in one paragraph. If using numbers, they MUST increase sequentially (1, 2, 3, 4, 5, ...) for the whole list — never restart at 1 partway through or repeat the same number for multiple items.
- Do NOT use markdown headings (#, ##, ###) anywhere in the answer. For section labels (e.g. "Analysis of Trends", "Key Findings"), use a bold line on its own (e.g. "**Analysis of Trends**") followed by a blank line, then the content/list.
- If figures for some years/items are missing from the excerpts, say so explicitly (e.g. "No figure found for 2003 in the available excerpts") rather than omitting them silently — this helps the user know what to check manually.
- HALLUCINATION PREVENTION — never invent figures, guess missing values, fabricate trends, or fabricate ministry/department allocations. If the excerpts and inventory genuinely contain nothing useful for the question, respond in [ANSWER] with exactly: "Insufficient evidence found in the available documents." and leave [RISKS]/[RECS] as "None identified" / omitted.
- If no relevant excerpts were found but a document exists in the inventory, acknowledge the document exists and suggest the user ask more specific questions about its content
- When the user asks to "open", "show", "view", or "read" a document — you cannot open files directly in this chat. Respond by summarising the key contents you have from the document excerpts, and tell the user they can view the full document in the Documents section.
- RECOMMENDATIONS must be specific and actionable — only include them if there is a genuine next step (e.g. "Review clause 4.2 on payment terms before signing"). Never add generic filler like "feel free to ask if you have more questions" as a recommendation.

Format your response EXACTLY like this (no other format):

[ANSWER]
Your detailed answer here with inline citations like [1]

[RISKS]
• risk 1 (write "None identified" if there are no risks)

[RECS]
• recommendation 1 (omit this section entirely if there are no specific actionable recommendations)`

// Per-query-type guidance appended to the user message — steers the model
// toward the right pipeline (Retrieve -> ... -> Answer) for each category
// without needing separate prompts/routes.
export const QUERY_TYPE_GUIDANCE: Record<QueryType, string> = {
  fact_lookup: 'QUERY TYPE: Fact lookup. Find the specific figure(s) requested, state them plainly with citations, and verify they appear in the excerpts before answering.',
  trend: 'QUERY TYPE: Trend analysis. Extract the relevant figures for each year/period from the excerpts and the PRE-COMPUTED FIGURES & GROWTH block, then describe the trend (direction, magnitude, anomalies) using those verified numbers.',
  comparison: 'QUERY TYPE: Comparison. Aggregate the relevant figures for each item being compared into a markdown table, then write a short comparative analysis (which is larger/smaller, by how much, and why if evident).',
  forecast: 'QUERY TYPE: Forecasting. Build a simple time series from the figures in the excerpts, describe the recent trend (e.g. average year-over-year growth), and project the next period using simple linear extrapolation. Clearly label this as an ESTIMATE based on historical trend, not a guaranteed figure, and state the assumption.',
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

// Questions about the knowledge base's contents/inventory itself (e.g. "do
// we have X?", "what files exist?") — the inventory passed to the model is
// the complete, authoritative list, so a "no chunks matched" answer here is
// a definitive statement about system state, not a failed retrieval.
const INVENTORY_QUERY_RX = /\b(do|does)\s+(we|you|i)\b.{0,20}\bhave\b|\bis there (a|any)|are there (any)?|what files|which files|list (of )?(the |all )?(files|documents)|how many (files|documents)|\bany (files|documents)\b/i

// Query types for which validated financial_facts are looked up and an
// AI second-pass verifier checks the answer against them.
export const FACTS_QUERY_TYPES: QueryType[] = ['fact_lookup', 'trend', 'comparison', 'forecast', 'anomaly_detection']

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
      .select('id, document_chunk_id, relevance_score, document_chunks(chunk_text, document_id, metadata, documents(title))')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })

    const citations = (data ?? []).map(row => {
      const chunk = Array.isArray(row.document_chunks) ? row.document_chunks[0] : row.document_chunks
      const rawDocs = chunk?.documents as { title: string } | { title: string }[] | null | undefined
      const docTitle = Array.isArray(rawDocs) ? rawDocs[0]?.title : rawDocs?.title
      const meta = (chunk?.metadata ?? {}) as Record<string, unknown>
      return {
        id: row.id,
        conversation_id: convId,
        document_chunk_id: row.document_chunk_id,
        document_id: chunk?.document_id ?? '',
        document_title: docTitle ?? 'Document',
        chunk_text: chunk?.chunk_text ?? '',
        relevance_score: row.relevance_score,
        highlight: null,
        page_number: (meta.page_number as number | null) ?? null,
        section_title: (meta.section_title as string | null) ?? null,
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

  const supabase = await createClient()
  const { query, newSession = true, history = [], convId: existingConvId = null } = await request.json()
  if (!query?.trim()) return new Response('Query required', { status: 400 })

  // Full conversation history — no cap, AI always has the complete context
  type HistMsg = { role: 'user' | 'assistant'; content: string }
  const historyMsgs: HistMsg[] = (history as HistMsg[])
    .filter(m => m.role === 'user' || m.role === 'assistant')

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
    const convRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: OPENAI_HEADERS,
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0.7, max_tokens: 120,
        messages: [
          { role: 'system', content: `You are Knowledge Innovations AI, a friendly AI document assistant for Knowledge Innovations — a Ghanaian AI strategy, FinTech, and digital transformation consultancy. The user sent a short conversational message. Reply warmly in 1–2 sentences. Address them as ${firstName}. Stay in character. Gently remind them you can help with documents if appropriate. Use the conversation history below to understand context before responding.` },
          ...historyMsgs,
          { role: 'user', content: query },
        ],
      }),
    })
    const convData = await convRes.json()
    const msg = convData.choices?.[0]?.message?.content?.trim()
      ?? `You're welcome, ${firstName}! Let me know whenever you have a question about your documents.`

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
    /* ── 1. Embed query + fetch document inventory in parallel ── */
    const svc = getServiceClient()
    const [embRes, { data: docInventory }] = await Promise.all([
      fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST', headers: OPENAI_HEADERS,
        body: JSON.stringify({ model: 'text-embedding-3-small', input: query }),
      }),
      // Full document list so AI knows WHAT files exist, not just what content matched
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
    const inventoryText = docInventory?.length
      ? `KNOWLEDGE BASE INVENTORY (${docInventory.length} file${docInventory.length !== 1 ? 's' : ''}):\n` +
        docInventory.map(d => `• ${d.title}${d.department ? ` [category: ${d.department}]` : ''}`).join('\n')
      : 'KNOWLEDGE BASE INVENTORY: No files have been uploaded yet.'

    /* ── 2. Hybrid retrieval (dense vector + BM25-ish FTS via RRF) ──
       Tenant isolation enforced by p_tenant_id — this is safe.
       Returns up to 30 candidates, reranked down to the top 10. */
    const { data: hybridChunks, error: rpcError } = await svc.rpc('match_document_chunks_hybrid', {
      query_embedding: queryEmbedding, query_text: query, p_tenant_id: tenantId,
      match_count: 30,
    })
    if (rpcError) console.error('[RAG] hybrid RPC error:', JSON.stringify(rpcError))

    type RetrievedChunk = { id: string; document_id: string; chunk_text: string; metadata: Record<string, unknown>; similarity: number; rrf_score?: number; rerank_score?: number }
    const chunks: RetrievedChunk[] = hybridChunks?.length
      ? await rerankChunks(query, hybridChunks as RetrievedChunk[], 10)
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
    const isDeepSearch = BROAD_QUERY_RX.test(query) || earlyQueryType === 'comparison' || earlyQueryType === 'trend'
    if (isDeepSearch) {
      const { data: perDocChunks, error: perDocError } = await svc.rpc('match_document_chunks_per_doc', {
        query_embedding: queryEmbedding, p_tenant_id: tenantId,
        match_count_per_doc: 3, match_threshold: 0.05,
      })
      if (perDocError) console.error('[RAG] per-doc RPC error:', JSON.stringify(perDocError))
      if (perDocChunks?.length) {
        const seen = new Set(chunks.map(c => c.id))
        for (const c of perDocChunks) if (!seen.has(c.id)) { chunks.push(c); seen.add(c.id) }
      }
    }

    /* ── No matching chunks — answer from inventory ─────────── */
    if (!chunks?.length) {
      const noDocRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: OPENAI_HEADERS,
        body: JSON.stringify({
          model: 'gpt-4o-mini', temperature: 0.4, max_tokens: 250,
          messages: [
            { role: 'system', content: `You are Knowledge Innovations AI, the assistant for Knowledge Innovations (a Ghanaian AI strategy, FinTech, and digital transformation consultancy).
No specific document excerpts matched this query, but you have the complete file inventory below.
IMPORTANT: If the user asks whether a file or category of document exists, CHECK the inventory and answer directly — "Yes, we have..." or "No, there are none...". Never say you cannot access files when they appear in the inventory. Be specific about names and categories.` },
            ...historyMsgs,
            { role: 'user', content: `${inventoryText}\n\nQuestion: ${query}` },
          ],
        }),
      })
      const noDocData = await noDocRes.json()
      const msg = noDocData.choices?.[0]?.message?.content?.trim()
        ?? "I couldn't find relevant content for that query. Check the Documents section to see what has been uploaded, or try rephrasing your question."

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

    const context = chunks
      .map((c, i) => `[${i + 1}] ${c.chunk_text}`)
      .join('\n\n')

    /* ── 2b. Deterministic calculation engine ────────────────────
       Extract figures + compute year-over-year growth ourselves so the
       model doesn't have to (and can't get the arithmetic wrong). */
    const growthCalcs = computeGrowthCalculations(chunks)
    const calcBlock = growthCalcs.length
      ? '\n\nPRE-COMPUTED FIGURES & GROWTH (verified — use these exact numbers):\n' +
        growthCalcs.map(g =>
          `- ${g.fromYear} → ${g.toYear}: ${g.fromValue} → ${g.toValue} (${g.unit}), `
          + `growth ${g.growthPct > 0 ? '+' : ''}${g.growthPct}% ${g.citations.map(n => `[${n}]`).join('')}`
        ).join('\n')
      : ''

    const queryType = earlyQueryType
    const guidance = QUERY_TYPE_GUIDANCE[queryType]
    const guidanceBlock = guidance ? `\n\n${guidance}` : ''

    /* ── 2c. Validated facts store ────────────────────────────────
       For numeric/analytical query types, look up pre-extracted,
       sanity-checked figures from financial_facts and hand them to the
       model as authoritative — this is what prevents wrong-table/
       wrong-year figures and implausible growth claims from prose alone. */
    let factsBlock = ''
    if (FACTS_QUERY_TYPES.includes(queryType)) {
      const { years, entityHint } = extractQueryFilters(query, chunks)

      let factsQuery = svc
        .from('financial_facts')
        .select('fiscal_year, entity, entity_type, metric, value, unit, page_number, section_title, document_id, confidence, flags')
        .eq('tenant_id', tenantId)
        .order('fiscal_year', { ascending: true })
        .limit(60)
      if (years.length) factsQuery = factsQuery.in('fiscal_year', years)
      if (entityHint) factsQuery = factsQuery.ilike('entity', `%${entityHint}%`)

      const { data: facts, error: factsError } = await factsQuery
      if (factsError) console.error('[RAG] financial_facts query error:', JSON.stringify(factsError))

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

    /* ── 3. Prefetch citation titles via service role ────────── */
    const chunkDetailsPromise = svc
      .from('document_chunks').select('id, documents(title)')
      .in('id', chunks.map(c => c.id))

    /* ── 4. Pre-generate conversation ID so we can include in done event ── */
    const title  = makeTitle(query)

    /* ── 5. Stream from gpt-4o-mini ─────────────────────────── */
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: OPENAI_HEADERS,
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0.2, max_tokens: isDeepSearch ? 1600 : 800, stream: true,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...historyMsgs,
          { role: 'user',   content: `${inventoryText}\n\nDOCUMENT EXCERPTS FROM SEARCH:\n${context}${calcBlock}${factsBlock}${guidanceBlock}\n\nQuestion: ${query}` },
        ],
      }),
      signal: request.signal,
    })

    const stream = new ReadableStream({
      async start(controller) {
        const reader  = openaiRes.body!.getReader()
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
              if (raw === '[DONE]') continue
              let parsed: { choices?: { delta?: { content?: string } }[] }
              try { parsed = JSON.parse(raw) } catch { continue }
              const token = parsed.choices?.[0]?.delta?.content ?? ''
              if (!token) continue
              fullText += token
              controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: token })}\n\n`))
            }
          }

          const { answer, risks, recommendations } = parseDelimited(fullText)

          /* ── Answer verification + confidence scoring ──────────
             Deterministic second pass: every non-percentage figure in the
             answer should appear in the retrieved chunks, and any "+X%"
             growth claim should match the actual change between the two
             cited figures. Combined with retrieval quality, this replaces
             the old hardcoded 0.85 confidence score. */
          const retrievalScores = chunks.map(c => c.rerank_score ?? c.similarity ?? c.rrf_score ?? 0)
          const verification = verifyAnswer(answer, chunks, retrievalScores)
          if (verification.unsupported.length) {
            console.log('[RAG] unsupported figures in answer:', verification.unsupported)
          }
          if (verification.growthChecks.some(g => !g.ok)) {
            console.log('[RAG] growth claim mismatches:', verification.growthChecks.filter(g => !g.ok))
          }

          /* ── AI second-pass verification ───────────────────────
             For fact-bearing query types, ask gpt-4o-mini to check the
             answer's claims against VALIDATED FACTS + the excerpts. Any
             issues are surfaced as risks and reduce the confidence score. */
          if (FACTS_QUERY_TYPES.includes(queryType)) {
            try {
              const { issues } = await verifyAnswerWithAI({
                query, answer, factsBlock, context, signal: request.signal,
              })
              if (issues.length) {
                console.log('[RAG] AI verifier issues:', issues)
                risks.push(...issues)
                verification.confidenceScore = Math.max(1, verification.confidenceScore - 15 * issues.length)
                verification.confidenceLevel =
                  verification.confidenceScore >= 75 ? 'High' : verification.confidenceScore >= 50 ? 'Medium' : 'Low'
              }
            } catch (e) {
              if (e instanceof Error && e.name === 'AbortError') throw e
            }
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
              if (convId && chunks.length) {
                await supabase.from('citations').insert(
                  chunks.map(c => ({
                    conversation_id: convId, document_chunk_id: c.id, relevance_score: c.similarity,
                  }))
                )
              }
            } catch (e) { console.error('Save failed:', e) }
          } else if (existingConvId) {
            convId = existingConvId
            await appendConv(existingConvId, answer, risks, recommendations)
          }

          // Build citation objects with the real DB-generated convId
          const { data: chunkDetails } = await chunkDetailsPromise
          const citations = chunks.map(c => {
            const detail  = chunkDetails?.find(d => d.id === c.id)
            const rawDocs = detail?.documents as { title: string } | { title: string }[] | null
            const docTitle = Array.isArray(rawDocs) ? rawDocs[0]?.title : rawDocs?.title
            const meta = c.metadata ?? {}
            return {
              id: c.id, conversation_id: convId ?? '',
              document_chunk_id: c.id,
              document_id: c.document_id,
              document_title: docTitle ?? 'Document',
              chunk_text: c.chunk_text,
              relevance_score: c.similarity,
              highlight: findHighlightSpan(c.chunk_text, query),
              page_number: (meta.page_number as number | null) ?? null,
              section_title: (meta.section_title as string | null) ?? null,
            }
          })

          controller.enqueue(enc.encode(
            `data: ${JSON.stringify({
              done: true, answer, risks, recommendations, citations,
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
