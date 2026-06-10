import { redirect } from 'next/navigation'
import { getMembership } from '@/lib/supabase/server'
import { canAccessDashboards } from '@/lib/roles'

export default async function DashboardsHubPage() {
  const membership = await getMembership()
  if (!membership || !canAccessDashboards(membership.role)) redirect('/ask')
  redirect('/dashboards/executive')
}
