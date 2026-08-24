import { NextRequest, NextResponse } from 'next/server'
import { getUser, getMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Pinned insights are shared across the whole tenant (not per-browser) —
// the dashboard is something a team shapes together, not a private view.
export async function GET() {
  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = svc()
  const { data, error } = await service
    .from('dashboard_pinned_insights')
    .select('id, label, question, insight, sentiment, sources, created_at')
    .eq('tenant_id', membership.tenant_id)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) {
    console.error('[Dashboard pinned] list failed:', error)
    return NextResponse.json({ pinned: [] })
  }
  return NextResponse.json({ pinned: data ?? [] })
}

export async function POST(request: NextRequest) {
  const [user, membership] = await Promise.all([getUser(), getMembership()])
  if (!user || !membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    label?: string; question?: string; insight?: string; sentiment?: string; sources?: string[]
  } | null
  if (!body?.question?.trim() || !body?.insight?.trim()) {
    return NextResponse.json({ error: 'question and insight are required' }, { status: 400 })
  }

  const service = svc()
  const { data, error } = await service.from('dashboard_pinned_insights').insert({
    tenant_id: membership.tenant_id,
    created_by: user.id,
    label: body.label?.trim() || 'Pinned',
    question: body.question.trim(),
    insight: body.insight.trim(),
    sentiment: body.sentiment ?? 'neutral',
    sources: body.sources ?? [],
  }).select('id, label, question, insight, sentiment, sources, created_at').single()

  if (error) {
    console.error('[Dashboard pinned] insert failed:', error)
    return NextResponse.json({ error: 'Could not pin this insight.' }, { status: 500 })
  }
  return NextResponse.json({ pinned: data })
}
