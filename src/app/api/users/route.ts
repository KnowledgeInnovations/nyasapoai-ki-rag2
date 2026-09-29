import { NextRequest, NextResponse } from 'next/server'
import { getMembership, getTenant } from '@/lib/supabase/server'
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
    .select('user_id, role, created_at, last_active_at, users:user_id (id, email, name)')
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
    last_active_at: string | null
    users: { id: string; email: string; name: string | null } | { id: string; email: string; name: string | null }[] | null
  }

  // Acceptance is judged by actual use of the workspace, not by
  // auth.users.last_sign_in_at — see the note in src/app/(app)/users/page.tsx
  // for why that field is unreliable here (mail security scanners follow the
  // invite link and sign the invitee in before they ever see the email).
  const members = ((memberships ?? []) as Row[]).map(m => {
    const user = Array.isArray(m.users) ? m.users[0] : m.users
    return {
      id:        m.user_id,
      email:     user?.email ?? '',
      name:      user?.name ?? '',
      role:      normalizeRole(m.role),
      createdAt: m.created_at,
      status:    m.last_active_at ? 'active' : 'pending',
      lastActiveAt: m.last_active_at,
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

  // Tenant-scoped domain restriction (empty list = unrestricted, the
  // default for any tenant that hasn't opted in via Settings). Platform
  // tenant is exempt — its admins legitimately span different domains.
  const tenant = await getTenant(membership.tenant_id)
  const allowedDomains = tenant?.email_domains ?? []
  if (!tenant?.is_platform && allowedDomains.length > 0) {
    const emailDomain = email.trim().toLowerCase().split('@')[1] ?? ''
    if (!allowedDomains.includes(emailDomain)) {
      return NextResponse.json({
        error: `This workspace only allows invites from: ${allowedDomains.join(', ')}`,
      }, { status: 400 })
    }
  }

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
