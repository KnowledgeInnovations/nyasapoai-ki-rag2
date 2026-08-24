import { NextResponse } from 'next/server'
import { getMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const service = svc()
  // Scoped by tenant_id, not just id — a delete for another tenant's pin id
  // (guessed or leaked) silently matches zero rows instead of succeeding.
  const { error } = await service
    .from('dashboard_pinned_insights')
    .delete()
    .eq('id', id)
    .eq('tenant_id', membership.tenant_id)

  if (error) {
    console.error('[Dashboard pinned] delete failed:', error)
    return NextResponse.json({ error: 'Could not remove this pin.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
