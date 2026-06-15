import { redirect } from 'next/navigation'
import { getUser, getMembership, getTenant } from '@/lib/supabase/server'
import AppShell from '@/components/app/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/auth/login')
  const membership = await getMembership()
  if (!membership) redirect('/auth/setup-workspace')
  const role = membership.role
  const tenant = await getTenant(membership.tenant_id)
  const tenantName = tenant?.name ?? 'NyasapoAI'
  return <AppShell user={user} role={role} tenantName={tenantName}>{children}</AppShell>
}
