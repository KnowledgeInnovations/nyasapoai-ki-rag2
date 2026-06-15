import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMembership, getTenant } from '@/lib/supabase/server'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Platform-admin only: permanently delete a tenant and everything in it
// (memberships, documents, chunks, etc. cascade via FK; storage files are
// removed best-effort).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenant = await getTenant(membership.tenant_id)
  if (membership.role !== 'senior' || !tenant?.is_platform) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (id === tenant.id) {
    return NextResponse.json({ error: 'Cannot delete the platform tenant' }, { status: 400 })
  }

  const service = svc()

  const { data: target } = await service
    .from('tenants')
    .select('id, is_platform')
    .eq('id', id)
    .maybeSingle()

  if (!target) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (target.is_platform) {
    return NextResponse.json({ error: 'Cannot delete the platform tenant' }, { status: 400 })
  }

  const { data: docs } = await service
    .from('documents')
    .select('file_path')
    .eq('tenant_id', id)

  const { error: deleteError } = await service.from('tenants').delete().eq('id', id)
  if (deleteError) {
    console.error('Tenant delete error:', deleteError)
    return NextResponse.json({ error: 'Failed to delete tenant' }, { status: 500 })
  }

  const filePaths = (docs ?? []).map(d => d.file_path).filter((p): p is string => !!p)
  if (filePaths.length > 0) {
    await service.storage.from('documents').remove(filePaths).catch(() => {})
  }

  return NextResponse.json({ success: true })
}
