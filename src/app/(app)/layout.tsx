import { redirect } from 'next/navigation'
import { getUser, getMembership } from '@/lib/supabase/server'
import AppShell from '@/components/app/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/auth/login')
  const membership = await getMembership()
  const role = membership?.role ?? 'staff'
  return <AppShell user={user} role={role}>{children}</AppShell>
}
