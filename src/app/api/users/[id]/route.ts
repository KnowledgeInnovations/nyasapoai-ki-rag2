import { NextRequest, NextResponse } from 'next/server'
import { mustCount } from '@/lib/dbResult'
import { getMembership, getUser, invalidateMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canManageUsers, normalizeRole, type Role } from '@/lib/roles'
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit'

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
  // Read before the update: "changed from Junior to Senior" is the useful
  // record, and the old value is gone a line later.
  const { data: previous } = await service
    .from('memberships').select('role')
    .eq('user_id', id).eq('tenant_id', membership.tenant_id).maybeSingle()
  const { data: subject } = await service
    .from('users').select('email').eq('id', id).maybeSingle()
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

  await recordAudit({
    tenantId: membership.tenant_id,
    userId: (await getUser())?.id ?? null,
    action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
    resourceType: 'user',
    resourceId: id,
    metadata: {
      email: subject?.email ?? null,
      from: previous?.role ? normalizeRole(previous.role) : null,
      to: normalizeRole(role),
    },
  })

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
  // Same reason as the role change: once the membership row is gone there is
  // nothing left to say who was removed.
  const { data: subject } = await service
    .from('users').select('email').eq('id', id).maybeSingle()
  const { data: hadRole } = await service
    .from('memberships').select('role')
    .eq('user_id', id).eq('tenant_id', membership.tenant_id).maybeSingle()

  const { error } = await service
    .from('memberships')
    .delete()
    .eq('user_id', id)
    .eq('tenant_id', membership.tenant_id)

  if (error) {
    console.error('Member remove error:', error)
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }

  await recordAudit({
    tenantId: membership.tenant_id,
    userId: user?.id ?? null,
    action: AUDIT_ACTIONS.USER_REMOVED,
    resourceType: 'user',
    resourceId: id,
    metadata: { email: subject?.email ?? null, role: hadRole?.role ?? null },
  })

  invalidateMembership(id)

  // If this user has no memberships left in any tenant, remove their auth
  // account too — otherwise Supabase Auth keeps treating the email as
  // registered and re-inviting it fails with "already registered".
  //
  // The count has to be a number somebody actually computed. A failed
  // query returns null, `!null` is true, and the account was then deleted
  // on the assumption that the person belonged to nothing — locking them
  // out of every other workspace they are a member of, irreversibly,
  // because of a dropped connection. Leaving a stale auth account behind
  // is a nuisance; deleting a live one is not recoverable.
  let remainingMemberships: number
  try {
    remainingMemberships = mustCount(
      await service
        .from('memberships')
        .select('user_id', { count: 'exact', head: true })
        .eq('user_id', id),
      "this user's remaining memberships",
    )
  } catch (e) {
    console.error('[users] keeping the auth account:', (e as Error).message)
    return NextResponse.json({
      success: true,
      note: 'Removed from this workspace. Their sign-in account was kept because we could not confirm whether they belong to another workspace.',
    })
  }

  if (remainingMemberships === 0) {
    const { error: authError } = await service.auth.admin.deleteUser(id)
    if (authError) console.error('Auth user delete error:', authError)
  }

  return NextResponse.json({ success: true })
}
