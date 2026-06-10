import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getMembership, getUser } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canManageUsers, normalizeRole } from '@/lib/roles'
import UsersClient, { type Member } from '@/components/app/UsersClient'

export const metadata: Metadata = { title: 'Users — Knowledge Innovations' }

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

  const members: Member[] = ((memberships ?? []) as Row[]).map(m => {
    const u = Array.isArray(m.users) ? m.users[0] : m.users
    return {
      id:        m.user_id,
      email:     u?.email ?? '',
      name:      u?.name ?? '',
      role:      normalizeRole(m.role),
      createdAt: m.created_at,
    }
  })

  return <UsersClient members={members} currentUserId={user?.id ?? ''} />
}
