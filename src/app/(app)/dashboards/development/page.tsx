import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { HardHat, Ruler, MessageSquare, Hammer } from 'lucide-react'
import { getMembership, getTenant, createClient } from '@/lib/supabase/server'
import { canAccessDashboards, isPlatformTenant } from '@/lib/roles'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { CATEGORIES } from '@/lib/documentCategories'
import DashboardShell from '@/components/app/DashboardShell'
import DashboardInsightsGroup from '@/components/app/DashboardInsightsGroup'
import { StatCard, DocList } from '@/components/app/DashboardWidgets'

export const metadata: Metadata = { title: 'Development Dashboard - NyasapoAI' }


function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const INSIGHTS = [
  { label: 'Project Progress',   question: 'What is the current construction progress on active projects? What percentage complete are they? Are there any delays, stoppages, or milestone achievements mentioned in site reports?' },
  { label: 'Costs & Budget',     question: 'Are there any budget overruns, cost escalations, procurement issues, or unexpected expenses mentioned in site reports or financial documents? How does actual spend compare to budget?' },
  { label: 'Contractor Quality', question: 'What is the performance of contractors and subcontractors? Are there any quality issues, defects, disputes, or non-compliance issues mentioned in the documents?' },
]

export default async function DevelopmentDashboard() {
  const membership = await getMembership()
  if (!membership || !canAccessDashboards(membership.role)) redirect('/ask')
  if (isPlatformTenant(await getTenant(membership.tenant_id))) redirect('/training')

  const supabase = await createClient()
  const service  = svc()
  const tid      = membership.tenant_id
  // Server Component rendered once per request, not memoized/re-invoked
  // like a Client Component — the purity rule has no special case for this.
  // eslint-disable-next-line react-hooks/purity
  const weekAgo  = new Date(Date.now() - 7 * 86_400_000).toISOString()

  const [
    { count: siteReportCount },
    { count: designCount },
    { count: convsWeek },
    { count: convsTotal },
    { data: siteDocs },
    { data: designDocs },
  ] = await Promise.all([
    service.from('documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).eq('department', 'site-reports').eq('status', 'ready'),
    service.from('documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).eq('department', 'design-plans').eq('status', 'ready'),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', weekAgo),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', tid),
    service.from('documents').select('id, title, department, status, created_at').eq('tenant_id', tid).eq('department', 'site-reports').order('created_at', { ascending: false }).limit(4),
    service.from('documents').select('id, title, department, status, created_at').eq('tenant_id', tid).eq('department', 'design-plans').order('created_at', { ascending: false }).limit(4),
  ])

  const siteReportCat = CATEGORIES.find(c => c.value === 'site-reports')
  const allDevDocs = [...(siteDocs ?? []), ...(designDocs ?? [])]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8)

  const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <DashboardShell title="Development Dashboard" description="Project progress, milestones, costs, and contractor performance from your documents." lastUpdated={now}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={HardHat}       label="Site Reports"        value={String(siteReportCount ?? 0)} sub="Indexed and searchable"        live color="text-orange-600 bg-orange-50" />
        <StatCard icon={Ruler}         label="Design and Plans"    value={String(designCount ?? 0)}     sub="Indexed and searchable"        live color="text-cyan-600 bg-cyan-50" />
        <StatCard icon={MessageSquare} label="AI Queries (7 days)" value={String(convsWeek ?? 0)}       sub={`${convsTotal ?? 0} all-time`} live color="text-brand bg-brand-light" />
        <StatCard icon={Hammer}        label="Project Status"      value="AI"                           sub="Analysed from documents"        live color="text-purple-600 bg-purple-50" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DashboardInsightsGroup insights={INSIGHTS} />
      </div>
      <DocList docs={allDevDocs} cat={siteReportCat} title="Site Reports and Design Plans" emptyText="No development documents yet" />
    </DashboardShell>
  )
}
