import { redirect } from 'next/navigation'
import { getMembership, getTenant } from '@/lib/supabase/server'
import { canAccessDashboards, isPlatformTenant } from '@/lib/roles'

export default async function DashboardsHubPage() {
  const membership = await getMembership()
  if (!membership || !canAccessDashboards(membership.role)) redirect('/ask')
  if (isPlatformTenant(await getTenant(membership.tenant_id))) redirect('/training')
  redirect('/dashboards/executive')
}
