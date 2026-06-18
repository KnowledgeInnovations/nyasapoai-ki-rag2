import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getMembership, getUser, getTenant } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canManageUsers, isPlatformTenant, normalizeRole } from '@/lib/roles'
import UsersClient, { type Member } from '@/components/app/UsersClient'

export const metadata: Metadata = { title: 'Users — NyasapoAI' }

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
  if (isPlatformTenant(tenant)) redirect('/training')

  const service = svc()
  const { data: memberships } = await service
    .from('memberships')
    .select('user_id, role, created_at, users:user_id (id, email, name)')
    .eq('tenant_id', membership.tenant_id)
    .order('created_at', { ascending: true })

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

  const members: Member[] = ((memberships ?? []) as Row[]).map(m => {
    const u = Array.isArray(m.users) ? m.users[0] : m.users
    return {
      id:        m.user_id,
      email:     u?.email ?? '',
      name:      u?.name ?? '',
      role:      normalizeRole(m.role),
      createdAt: m.created_at,
      status:    authStatusById.get(m.user_id) ?? 'pending',
    }
  })

  return <UsersClient members={members} currentUserId={user?.id ?? ''} />
}
