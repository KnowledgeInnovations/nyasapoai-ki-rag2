import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getMembership, getUser, getTenant } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canManageUsers, isPlatformTenant, normalizeRole } from '@/lib/roles'
import UsersClient, { type Member } from '@/components/app/UsersClient'

export const metadata: Metadata = { title: 'Users — Nyansa AI' }

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export default async function UsersPage() {
  const [membership, user] = await Promise.all([getMembership(), getUser()])
  if (!membership || !canManageUsers(membership.role)) redirect('/ask')
  const tenant = await getTenant(membership.tenant_id)
  if (isPlatformTenant(tenant)) redirect('/admin/tenants')

  const service = svc()
  const { data: memberships } = await service
    .from('memberships')
    .select('user_id, role, created_at, last_active_at, users:user_id (id, email, name)')
    .eq('tenant_id', membership.tenant_id)
    .order('created_at', { ascending: true })

  type Row = {
    user_id: string
    role: string
    created_at: string
    last_active_at: string | null
    users: { id: string; email: string; name: string | null } | { id: string; email: string; name: string | null }[] | null
  }

  // An invite counts as accepted only once the person has actually used the
  // workspace — memberships.last_active_at, which the app layout touches on
  // every protected request.
  //
  // auth.users.last_sign_in_at cannot be used for this. Corporate mail
  // security scanners (Microsoft Defender Safe Links and the like) fetch every
  // URL in an incoming message, which lands on Supabase's one-time verify
  // endpoint and signs the invitee in before they have seen the email at all.
  // Observed on this tenant: four invitees were "signed in" 20-51 seconds
  // after their invites were created, none of whom had ever opened the app.
  // Keying off last_sign_in_at therefore flipped every invite from "Invite
  // pending" to accepted within a minute of sending it.
  const members: Member[] = ((memberships ?? []) as Row[]).map(m => {
    const u = Array.isArray(m.users) ? m.users[0] : m.users
    return {
      id:        m.user_id,
      email:     u?.email ?? '',
      name:      u?.name ?? '',
      role:      normalizeRole(m.role),
      createdAt: m.created_at,
      status:    m.last_active_at ? 'active' : 'pending',
      lastActiveAt: m.last_active_at,
    }
  })

  return <UsersClient members={members} currentUserId={user?.id ?? ''} />
}
