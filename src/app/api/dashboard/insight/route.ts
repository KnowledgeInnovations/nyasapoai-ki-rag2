import { NextRequest, NextResponse } from 'next/server'
import { getMembership, getTenant } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { claudeComplete } from '@/lib/claude'
import { DEFAULT_TENANT_DESCRIPTION } from '@/lib/tenant'

// A function, not a module-level constant — see getAnthropicHeaders() in
// claude.ts for why: Next.js dev-server env reloads can bake a stale/undefined
// key into a constant captured at import time.
function getOpenAIHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  }
}

export const maxDuration = 30

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: NextRequest) {
  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenant = await getTenant(membership.tenant_id)
  const orgName = tenant?.name ?? 'Nyansa AI'
  const orgDescription = tenant?.description ?? DEFAULT_TENANT_DESCRIPTION

  const body = await request.json().catch(() => null) as { question?: string; label?: string } | null
  const { question, label } = body ?? {}
  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 })

  const service = svc()

  // Embed the question
  const embRes = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: getOpenAIHeaders(),
    body: JSON.stringify({ model: 'text-embedding-3-small', input: question }),
  })
  if (!embRes.ok) {
    return NextResponse.json({ insight: 'Insight temporarily unavailable.', sentiment: 'neutral' as const, sources: [], noData: true, label })
  }
  const embData = await embRes.json()
  const embedding: number[] | undefined = embData?.data?.[0]?.embedding
  if (!embedding) {
    return NextResponse.json({ insight: 'Insight temporarily unavailable.', sentiment: 'neutral' as const, sources: [], noData: true, label })
  }

  // Vector search — same RPC as the Ask AI chat
  const { data: chunks } = await service.rpc('match_document_chunks', {
    query_embedding: embedding,
    p_tenant_id: membership.tenant_id,
    match_threshold: 0.1,
    match_count: 10,
  })

  // No documents uploaded yet
  if (!chunks?.length) {
    return NextResponse.json({
      insight: 'No relevant documents found. Upload documents related to this area to see AI insights here.',
      sentiment: 'neutral' as const,
      sources: [],
      noData: true,
    })
  }

  const context = (chunks as { chunk_text: string }[])
    .map((c, i) => `[${i + 1}] ${c.chunk_text}`)
    .join('\n\n')

  // Claude generates a business insight + sentiment rating
  const raw = await claudeComplete({
    temperature: 0.3,
    maxTokens: 250,
    system: `You are a sharp business analyst for ${orgName}, ${orgDescription}.
Analyse the document excerpts and answer the question directly and concisely (2–4 sentences max).
Focus on real numbers, dates, names, and facts you can see.
Be honest: flag problems clearly. Praise progress where real.
After your answer, on a new line write exactly: SENTIMENT:positive OR SENTIMENT:negative OR SENTIMENT:caution OR SENTIMENT:neutral`,
    messages: [
      {
        role: 'user',
        content: `Context from company documents:\n${context}\n\nQuestion: ${question}`,
      },
    ],
  }).catch(() => '')

  const sentimentMatch = raw.match(/SENTIMENT:(positive|negative|caution|neutral)/i)
  const sentiment = (sentimentMatch?.[1]?.toLowerCase() ?? 'neutral') as 'positive' | 'negative' | 'caution' | 'neutral'
  const insight = raw.replace(/\s*SENTIMENT:\w+\s*$/i, '').trim()

  // Fetch source document titles
  const chunkIds = (chunks as { id: string }[]).map(c => c.id)
  const { data: details } = await service
    .from('document_chunks')
    .select('id, documents(title)')
    .in('id', chunkIds)

  const sources = [...new Set(
    (details ?? []).map(d => {
      const docs = d.documents as { title: string } | { title: string }[] | null
      return Array.isArray(docs) ? docs[0]?.title : docs?.title
    }).filter((t): t is string => Boolean(t))
  )].slice(0, 4)

  return NextResponse.json({ insight, sentiment, sources, label })
}
