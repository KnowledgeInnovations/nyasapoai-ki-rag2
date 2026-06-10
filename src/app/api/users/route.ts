import { NextRequest, NextResponse } from 'next/server'
import { getMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canManageUsers, normalizeRole, type Role } from '@/lib/roles'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET() {
  const membership = await getMembership()
  if (!membership || !canManageUsers(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const service = svc()
  const { data: memberships, error } = await service
    .from('memberships')
    .select('user_id, role, created_at, users:user_id (id, email, name)')
    .eq('tenant_id', membership.tenant_id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Members list error:', error)
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 })
  }

  type Row = {
    user_id: string
    role: string
    created_at: string
    users: { id: string; email: string; name: string | null } | { id: string; email: string; name: string | null }[] | null
  }

  // Determine invite-acceptance status from auth.users — a member who hasn't
  // signed in yet is still "pending" even though their membership row exists.
  const authStatusById = new Map<string, 'active' | 'pending'>()
  let page = 1
  for (;;) {
    const { data, error: listError } = await service.auth.admin.listUsers({ page, perPage: 1000 })
    if (listError) { console.error('List auth users error:', listError); break }
    for (const u of data.users) {
      authStatusById.set(u.id, u.last_sign_in_at ? 'active' : 'pending')
    }
    if (data.users.length < 1000) break
    page++
  }

  const members = ((memberships ?? []) as Row[]).map(m => {
    const user = Array.isArray(m.users) ? m.users[0] : m.users
    return {
      id:        m.user_id,
      email:     user?.email ?? '',
      name:      user?.name ?? '',
      role:      normalizeRole(m.role),
      createdAt: m.created_at,
      status:    authStatusById.get(m.user_id) ?? 'pending',
    }
  })

  return NextResponse.json({ members })
}

export async function POST(request: NextRequest) {
  const membership = await getMembership()
  if (!membership || !canManageUsers(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { email, role } = await request.json() as { email?: string; role?: Role }
  if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const service = svc()

  const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${request.nextUrl.origin}/auth/set-password`,
  })
  if (inviteError || !invited.user) {
    console.error('Invite error:', inviteError)
    return NextResponse.json({ error: inviteError?.message ?? 'Failed to invite user' }, { status: 500 })
  }

  const { error: membershipError } = await service
    .from('memberships')
    .insert({
      user_id:   invited.user.id,
      tenant_id: membership.tenant_id,
      role:      normalizeRole(role),
    })

  if (membershipError) {
    console.error('Membership insert error:', membershipError)
    return NextResponse.json({ error: 'Failed to add user to workspace' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
