import { NextRequest, NextResponse } from 'next/server'
import { createClient, getUser, getMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// Service-role client for document/chunk queries — bypasses RLS.
// Tenant isolation is enforced by p_tenant_id in the RPC, so this is safe.
function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const OPENAI_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
}

const SYSTEM_PROMPT = `You are Knowledge Innovations AI, the assistant for Knowledge Innovations, a Ghanaian AI strategy, FinTech, and digital transformation consultancy.

Personality: warm, polite, professional — a knowledgeable colleague always ready to help.

You have TWO sources of information — use BOTH:
1. KNOWLEDGE BASE INVENTORY — the complete list of every file uploaded. Use this to answer questions like "do we have X?" or "what files exist?". If a file appears in the inventory, it EXISTS — tell the user clearly.
2. DOCUMENT EXCERPTS — relevant text retrieved from those files by semantic search. Use these to answer questions about the actual content of documents.

Rules:
- For "do we have X?" or "is there a document about Y?" — CHECK the inventory first and answer directly. Never say you cannot access files when they appear in the inventory.
- For content questions — quote and cite from the document excerpts using [1], [2] etc.
- Never invent facts not present in the excerpts or inventory
- Be direct and specific — give names, numbers, and categories from the documents
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

function parseDelimited(text: string) {
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

// Derive a short memorable title from the query
function makeTitle(query: string): string {
  const q = query.trim().replace(/[?!.]+$/, '')
  if (q.split(/\s+/).length <= 3) return q || 'Quick chat'
  const words = q.split(/\s+/).slice(0, 6)
  return words.join(' ') + (q.split(/\s+/).length > 6 ? '…' : '')
}

/* ── GET: conversation history ────────────────────────────── */
export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = await createClient()

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
        await streamWords(c, enc, msg, { risks: [], recommendations: [], citations: [], confidence_score: 1, convId, title })
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

    /* ── 2. Retrieve chunks via service role (bypasses RLS) ─────
       Tenant isolation enforced by p_tenant_id — this is safe. */
    const { data: chunks, error: rpcError } = await svc.rpc('match_document_chunks', {
      query_embedding: queryEmbedding, p_tenant_id: tenantId,
      match_threshold: 0.15, match_count: 8,
    })
    if (rpcError) console.error('[RAG] RPC error:', JSON.stringify(rpcError))

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

      const title = makeTitle(query)
      let convId: string | null = null
      if (newSession) {
        convId = await saveConv(msg, [], [], 0.3)
      } else if (existingConvId) {
        convId = existingConvId
        await appendConv(existingConvId, msg, [], [])
      }

      return new Response(
        new ReadableStream({ async start(c) {
          await streamWords(c, enc, msg, { risks: [], recommendations: [], citations: [], confidence_score: 0.3, convId, title })
        }}),
        { headers: sseHeaders() }
      )
    }

    const context = chunks
      .map((c: { chunk_text: string }, i: number) => `[${i + 1}] ${c.chunk_text}`)
      .join('\n\n')

    /* ── 3. Prefetch citation titles via service role ────────── */
    const chunkDetailsPromise = svc
      .from('document_chunks').select('id, documents(title)')
      .in('id', chunks.map((c: { id: string }) => c.id))

    /* ── 4. Pre-generate conversation ID so we can include in done event ── */
    const title  = makeTitle(query)

    /* ── 5. Stream from gpt-4o-mini ─────────────────────────── */
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: OPENAI_HEADERS,
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 800, stream: true,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...historyMsgs,
          { role: 'user',   content: `${inventoryText}\n\nDOCUMENT EXCERPTS FROM SEARCH:\n${context}\n\nQuestion: ${query}` },
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
                  query, response: answer, confidence_score: 0.85, risks, recommendations,
                  messages,
                })
                .select('id')
                .single()
              if (convErr) console.error('Conv save error:', convErr.message)
              convId = conv?.id ?? null
              if (convId && chunks.length) {
                await supabase.from('citations').insert(
                  chunks.map((c: { id: string; similarity: number }) => ({
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
          const citations = chunks.map((c: { id: string; chunk_text: string; similarity: number }) => {
            const detail  = chunkDetails?.find(d => d.id === c.id)
            const rawDocs = detail?.documents as { title: string } | { title: string }[] | null
            const docTitle = Array.isArray(rawDocs) ? rawDocs[0]?.title : rawDocs?.title
            return {
              id: c.id, conversation_id: convId ?? '',
              document_chunk_id: c.id,
              document_title: docTitle ?? 'Document',
              chunk_text: c.chunk_text,
              relevance_score: c.similarity,
              highlight: findHighlightSpan(c.chunk_text, query),
            }
          })

          controller.enqueue(enc.encode(
            `data: ${JSON.stringify({ done: true, answer, risks, recommendations, citations, confidence_score: 0.85, convId, title })}\n\n`
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
