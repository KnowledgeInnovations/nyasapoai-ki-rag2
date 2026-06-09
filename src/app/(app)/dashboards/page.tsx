import { redirect } from 'next/navigation'
import { getMembership } from '@/lib/supabase/server'

const ALLOWED_ROLES = ['admin', 'exco', 'senior_manager', 'senior', 'middle']

export default async function DashboardsHubPage() {
  const membership = await getMembership()
  if (!membership || !ALLOWED_ROLES.includes(membership.role)) redirect('/ask')
  redirect('/dashboards/executive')
}
