import { NextRequest, NextResponse } from 'next/server'
import { getMembership, getTenant, getUser } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canManageUsers, normalizeRole, type Role } from '@/lib/roles'
import { limitsFor, canAddUser, canAddSeniorUser } from '@/lib/plans'
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit'
import { sendEmail } from '@/lib/email'
import { tenantUrlForHost } from '@/lib/domain'
import type { SupabaseClient } from '@supabase/supabase-js'

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
  // auth.users.last_sign_in_at — see the note in src/app/(app)/settings/users/page.tsx
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

/**
 * The auth account for an address, or null.
 *
 * public.users mirrors auth.users through a trigger and is the cheap
 * lookup, but a mirror can be missing a row — the trigger is not part of
 * the signup transaction — and being wrong here means telling someone their
 * colleague has no account when they do. So a miss falls through to auth
 * itself, which is the record that actually decides whether an invite is
 * refused.
 */
async function findAuthUser(
  service: SupabaseClient,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const wanted = email.trim().toLowerCase()

  const { data: mirrored } = await service
    .from('users')
    .select('id, email')
    .ilike('email', wanted)
    .maybeSingle()
  if (mirrored?.id) return { id: mirrored.id, email: mirrored.email }

  // Supabase's admin API has no lookup by address, only a listing, so this
  // is a scan. Bounded at ten pages: beyond that the mirror is the only
  // sane answer, and a project with ten thousand accounts needs a different
  // mechanism than this route.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 })
    if (error || !data?.users?.length) return null
    const hit = data.users.find(u => (u.email ?? '').toLowerCase() === wanted)
    if (hit) return { id: hit.id, email: hit.email ?? wanted }
    if (data.users.length < 1000) return null
  }
  return null
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => HTML_ESCAPES[c])
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

  // Seat limits for the workspace's plan. Checked here on the server, before
  // the invite is sent — an invite that succeeds and then cannot be seated
  // leaves an auth user with no membership, which is how orphaned accounts
  // appear. The platform tenant is exempt; it is not a paying workspace.
  if (!tenant?.is_platform) {
    const limits = limitsFor(tenant?.plan)
    const { data: seats, error: seatsError } = await service
      .from('memberships')
      .select('role')
      .eq('tenant_id', membership.tenant_id)

    if (seatsError) {
      console.error('Seat count failed:', seatsError)
      return NextResponse.json({ error: 'Could not verify plan limits' }, { status: 500 })
    }

    const userCheck = canAddUser(limits, seats?.length ?? 0)
    if (!userCheck.allowed) {
      return NextResponse.json({ error: userCheck.reason }, { status: 403 })
    }

    if (normalizeRole(role ?? 'junior') === 'senior') {
      const seniors = (seats ?? []).filter(s => normalizeRole(s.role) === 'senior').length
      const seniorCheck = canAddSeniorUser(limits, seniors)
      if (!seniorCheck.allowed) {
        return NextResponse.json({ error: seniorCheck.reason }, { status: 403 })
      }
    }
  }

  // An account can already exist — the same person working with two
  // customers, a contractor, or someone removed from this very workspace
  // who is being brought back. inviteUserByEmail refuses any address that
  // holds an identity ANYWHERE on the project, so calling it
  // unconditionally returned "A user with this email address has already
  // been registered" and the membership insert below was never reached.
  // The effect was that such a person could not be added to a second
  // workspace at all.
  const existing = await findAuthUser(service, email)

  let userId: string
  let alreadyHadAccount = false

  if (existing) {
    alreadyHadAccount = true

    const { data: already } = await service
      .from('memberships')
      .select('role')
      .eq('user_id', existing.id)
      .eq('tenant_id', membership.tenant_id)
      .maybeSingle()

    if (already) {
      return NextResponse.json(
        { error: 'That person is already a member of this workspace.' },
        { status: 409 },
      )
    }

    userId = existing.id
  } else {
    const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${request.nextUrl.origin}/auth/set-password`,
    })
    if (inviteError || !invited.user) {
      console.error('Invite error:', inviteError)
      return NextResponse.json({ error: inviteError?.message ?? 'Failed to invite user' }, { status: 500 })
    }
    userId = invited.user.id
  }

  const { error: membershipError } = await service
    .from('memberships')
    .insert({
      user_id:   userId,
      tenant_id: membership.tenant_id,
      role:      normalizeRole(role),
    })

  if (membershipError) {
    console.error('Membership insert error:', membershipError)
    return NextResponse.json({ error: 'Failed to add user to workspace' }, { status: 500 })
  }

  // Told by us, not by Supabase. An existing account needs no new password
  // and no token — it needs to know that a second workspace is now there.
  // Sending a Supabase auth link instead would be actively harmful: only
  // the most recently issued token for a user is valid, whatever its type,
  // so a "welcome" link here would silently invalidate a password reset or
  // an invitation that person was part-way through. This email carries no
  // token at all.
  if (alreadyHadAccount) {
    const workspaceUrl = tenant?.subdomain
      ? tenantUrlForHost(tenant.subdomain, '/ask', request.headers.get('host'))
      : request.nextUrl.origin
    const workspaceName = tenant?.name ?? 'a workspace'
    try {
      await sendEmail({
        to: email,
        subject: `You have been added to ${workspaceName} on Nyansa AI`,
        text:
          `You have been added to ${workspaceName} on Nyansa AI.\n\n` +
          `You already have a Nyansa AI account, so there is nothing to set up — ` +
          `sign in as you normally do and this workspace will be there.\n\n` +
          `${workspaceUrl}\n\n` +
          `Nyansa AI`,
        html:
          `<p>You have been added to <strong>${escapeHtml(workspaceName)}</strong> on Nyansa AI.</p>` +
          `<p>You already have a Nyansa AI account, so there is nothing to set up — sign in as you normally do and this workspace will be there.</p>` +
          `<p><a href="${escapeHtml(workspaceUrl)}">${escapeHtml(workspaceUrl)}</a></p>` +
          `<p style="color:#888;font-size:12px">Nyansa AI</p>`,
      })
    } catch (e) {
      // The membership is what granted access and it already exists.
      // Failing the request now would tell the admin the person was not
      // added when they were.
      console.error('[users] could not send the workspace-added notice:', (e as Error).message)
    }
  }

  // Recorded after the membership exists, not after the invite was sent:
  // the invite can be delivered and never accepted, but the membership is
  // the thing that granted access.
  await recordAudit({
    tenantId: membership.tenant_id,
    userId: (await getUser())?.id ?? null,
    action: AUDIT_ACTIONS.USER_INVITED,
    resourceType: 'user',
    resourceId: userId,
    metadata: { email, role: normalizeRole(role), existingAccount: alreadyHadAccount },
  })

  return NextResponse.json({
    success: true,
    existingAccount: alreadyHadAccount,
    message: alreadyHadAccount
      ? 'That person already had a Nyansa AI account, so there is no invitation to accept. They have been added to this workspace and told by email.'
      : undefined,
  })
}
