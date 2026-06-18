import { NextRequest, NextResponse } from 'next/server'
import { getMembership, getUser, invalidateMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canManageUsers, normalizeRole, type Role } from '@/lib/roles'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const membership = await getMembership()
  if (!membership || !canManageUsers(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { role } = await request.json() as { role?: Role }
  if (!role) return NextResponse.json({ error: 'Role is required' }, { status: 400 })

  const service = svc()
  const { error } = await service
    .from('memberships')
    .update({ role: normalizeRole(role) })
    .eq('user_id', id)
    .eq('tenant_id', membership.tenant_id)

  if (error) {
    console.error('Role update error:', error)
    return NextResponse.json({ error: 'Failed to update role' }, { status: 500 })
  }

  invalidateMembership(id)
  return NextResponse.json({ success: true })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const membership = await getMembership()
  if (!membership || !canManageUsers(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const user = await getUser()
  if (user?.id === id) {
    return NextResponse.json({ error: 'You cannot remove yourself from the workspace' }, { status: 400 })
  }

  const service = svc()
  const { error } = await service
    .from('memberships')
    .delete()
    .eq('user_id', id)
    .eq('tenant_id', membership.tenant_id)

  if (error) {
    console.error('Member remove error:', error)
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }

  invalidateMembership(id)

  // If this user has no memberships left in any tenant, remove their auth
  // account too — otherwise Supabase Auth keeps treating the email as
  // registered and re-inviting it fails with "already registered".
  const { count } = await service
    .from('memberships')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', id)

  if (!count) {
    const { error: authError } = await service.auth.admin.deleteUser(id)
    if (authError) console.error('Auth user delete error:', authError)
  }

  return NextResponse.json({ success: true })
}
