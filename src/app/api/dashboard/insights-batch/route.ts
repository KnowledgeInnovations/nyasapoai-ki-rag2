import { NextRequest, NextResponse } from 'next/server'
import { getMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const maxDuration = 30

const OPENAI_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
}

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface InsightQuestion { question: string; label: string }
type Sentiment = 'positive' | 'negative' | 'caution' | 'neutral'

export async function POST(request: NextRequest) {
  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { questions } = await request.json() as { questions: InsightQuestion[] }
  if (!questions?.length) return NextResponse.json({ insights: [] })

  const service = svc()
  const tid = membership.tenant_id

  // ── 1. Embed ALL questions in one batch call ───────────────
  const embRes = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: OPENAI_HEADERS,
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: questions.map(q => q.question),
    }),
  })
  const embData = await embRes.json()
  const embeddings: number[][] = (embData.data as { index: number; embedding: number[] }[])
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding)

  // ── 2. Inventory + all vector searches in parallel ─────────
  const [{ data: docInventory }, ...chunkResults] = await Promise.all([
    service.from('documents').select('title, department').eq('tenant_id', tid).eq('status', 'ready').limit(100),
    ...questions.map((_, i) =>
      service.rpc('match_document_chunks', {
        query_embedding: embeddings[i],
        p_tenant_id: tid,
        match_threshold: 0.1,
        match_count: 6,
      })
    ),
  ])

  const inventoryText = docInventory?.length
    ? `KNOWLEDGE BASE: ${docInventory.map(d => `${d.title}${d.department ? ` [${d.department}]` : ''}`).join(', ')}`
    : 'No documents uploaded yet.'

  // ── 3. All GPT calls in parallel ───────────────────────────
  const insights = await Promise.all(
    questions.map(async (q, i) => {
      const chunks = (chunkResults[i] as { data: { id: string; chunk_text: string }[] | null }).data

      if (!chunks?.length) {
        return { label: q.label, insight: 'No relevant documents found. Upload documents to see insights here.', sentiment: 'neutral' as Sentiment, sources: [], noData: true }
      }

      const context = chunks.map((c, j) => `[${j + 1}] ${c.chunk_text}`).join('\n\n')

      const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: OPENAI_HEADERS,
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 150,
          messages: [
            {
              role: 'system',
              content: `You are a business analyst for Knowledge Innovations, a Ghanaian AI strategy, FinTech, and digital transformation consultancy. Answer in 2-3 sentences with specific facts, figures, and names from the documents. End with: SENTIMENT:positive OR SENTIMENT:negative OR SENTIMENT:caution OR SENTIMENT:neutral`,
            },
            {
              role: 'user',
              content: `${inventoryText}\n\nDocument excerpts:\n${context}\n\nQuestion: ${q.question}`,
            },
          ],
        }),
      })
      const gptData = await gptRes.json()
      const raw: string = gptData.choices?.[0]?.message?.content ?? ''
      const sentimentMatch = raw.match(/SENTIMENT:(positive|negative|caution|neutral)/i)
      const sentiment = (sentimentMatch?.[1]?.toLowerCase() ?? 'neutral') as Sentiment
      const insight = raw.replace(/\s*SENTIMENT:\w+\s*$/i, '').trim()

      // Get source titles (single lookup for all chunks in this insight)
      const { data: details } = await service
        .from('document_chunks')
        .select('id, documents(title)')
        .in('id', chunks.map(c => c.id))

      const sources = [
        ...new Set(
          (details ?? []).map(d => {
            const docs = d.documents as { title: string } | { title: string }[] | null
            return Array.isArray(docs) ? docs[0]?.title : docs?.title
          }).filter((t): t is string => Boolean(t))
        ),
      ].slice(0, 3)

      return { label: q.label, insight, sentiment, sources }
    })
  )

  return NextResponse.json({ insights })
}
