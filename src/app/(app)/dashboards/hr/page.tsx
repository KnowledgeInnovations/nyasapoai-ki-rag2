import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Users, UserPlus, MessageSquare, Calendar } from 'lucide-react'
import { getMembership, getTenant, createClient } from '@/lib/supabase/server'
import { canAccessDashboards, isPlatformTenant } from '@/lib/roles'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import DashboardShell from '@/components/app/DashboardShell'
import DashboardInsightsGroup from '@/components/app/DashboardInsightsGroup'
import { StatCard } from '@/components/app/DashboardWidgets'

export const metadata: Metadata = { title: 'HR Dashboard - Nyansa AI' }


function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const INSIGHTS = [
  { label: 'Staffing & Headcount',  question: 'What is the current staffing situation? Are there any vacancies, new hires, departures, or headcount changes mentioned in HR documents? Include specific numbers and departments.' },
  { label: 'Performance & KPIs',    question: 'What do the documents reveal about employee performance, KPI achievements, appraisal results, or disciplinary matters? Who is performing well or struggling?' },
  { label: 'Recruitment & Training', question: 'What recruitment activities, training programmes, skills gaps, or development plans are mentioned in the documents? What positions are being filled or need filling?' },
]

export default async function HRDashboard() {
  const membership = await getMembership()
  if (!membership || !canAccessDashboards(membership.role)) redirect('/ask')
  if (isPlatformTenant(await getTenant(membership.tenant_id))) redirect('/admin/tenants')

  const supabase = await createClient()
  const service  = svc()
  const tid      = membership.tenant_id
  // Server Component rendered once per request, not memoized/re-invoked
  // like a Client Component — the purity rule has no special case for this.
  // eslint-disable-next-line react-hooks/purity
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const [
    { count: docCount },
    { count: convsMonth },
    { count: convsTotal },
  ] = await Promise.all([
    service.from('documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).eq('status', 'ready'),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthAgo),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', tid),
  ])

  const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <DashboardShell title="HR Dashboard" description="Headcount, recruitment, performance, and staff development from your documents." lastUpdated={now}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Users}         label="Documents Indexed"    value={String(docCount ?? 0)}   sub="Workspace knowledge"           live color="text-rose-600 bg-rose-50" />
        <StatCard icon={MessageSquare} label="AI Queries (30 days)" value={String(convsMonth ?? 0)} sub={`${convsTotal ?? 0} all-time`} live color="text-brand bg-brand-light" />
        <StatCard icon={UserPlus}      label="Staffing Status"      value="AI"                      sub="Analysed from documents"       live color="text-amber-600 bg-amber-50" />
        <StatCard icon={Calendar}      label="Leave & Attendance"   value="AI"                      sub="Analysed from documents"       live color="text-purple-600 bg-purple-50" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DashboardInsightsGroup insights={INSIGHTS} />
      </div>
    </DashboardShell>
  )
}
