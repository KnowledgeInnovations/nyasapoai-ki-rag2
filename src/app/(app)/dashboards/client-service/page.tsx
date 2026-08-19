import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { HeartHandshake, MessageSquare, ClipboardList, Star } from 'lucide-react'
import { getMembership, getTenant, createClient } from '@/lib/supabase/server'
import { canAccessDashboards, isPlatformTenant } from '@/lib/roles'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { CATEGORIES } from '@/lib/documentCategories'
import DashboardShell from '@/components/app/DashboardShell'
import DashboardInsightsGroup from '@/components/app/DashboardInsightsGroup'
import { StatCard, DocList } from '@/components/app/DashboardWidgets'

export const metadata: Metadata = { title: 'Client Service Dashboard - Nyansa AI' }


function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const INSIGHTS = [
  { label: 'Client Issues',    question: 'What client complaints, outstanding requests, disputes, or unresolved issues are mentioned in the uploaded documents? Who are the clients involved and what is the status?' },
  { label: 'Onboarding & Pay', question: 'What is the client onboarding status? Are there any delayed payments, outstanding balances, payment plans, or collection issues mentioned in client documents?' },
  { label: 'Satisfaction',     question: 'What do the documents reveal about client satisfaction levels, feedback, inspection outcomes, or service delivery quality?' },
]

export default async function ClientServiceDashboard() {
  const membership = await getMembership()
  if (!membership || !canAccessDashboards(membership.role)) redirect('/ask')
  if (isPlatformTenant(await getTenant(membership.tenant_id))) redirect('/admin/tenants')

  const supabase = await createClient()
  const service  = svc()
  const tid      = membership.tenant_id
  // Server Component rendered once per request, not memoized/re-invoked
  // like a Client Component — the purity rule has no special case for this.
  // eslint-disable-next-line react-hooks/purity
  const weekAgo  = new Date(Date.now() - 7 * 86_400_000).toISOString()

  const [
    { count: legalCount },
    { count: convsWeek },
    { count: convsTotal },
    { data: legalDocs },
  ] = await Promise.all([
    service.from('documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).eq('department', 'legal').eq('status', 'ready'),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', weekAgo),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', tid),
    service.from('documents').select('id, title, department, status, created_at').eq('tenant_id', tid).eq('department', 'legal').order('created_at', { ascending: false }).limit(6),
  ])

  const cat = CATEGORIES.find(c => c.value === 'legal')
  const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <DashboardShell title="Client Service Dashboard" description="Client onboarding, payments, satisfaction, and open requests from your documents." lastUpdated={now}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={HeartHandshake} label="Legal and Client Docs" value={String(legalCount ?? 0)} sub="Permits, deeds, compliance"   live color="text-cyan-600 bg-cyan-50" />
        <StatCard icon={MessageSquare}  label="AI Queries (7 days)"   value={String(convsWeek ?? 0)}  sub={`${convsTotal ?? 0} all-time`} live color="text-brand bg-brand-light" />
        <StatCard icon={ClipboardList}  label="Client Issues"         value="AI"                      sub="Analysed from documents"       live color="text-amber-600 bg-amber-50" />
        <StatCard icon={Star}           label="Satisfaction"          value="AI"                      sub="Analysed from documents"       live color="text-gold-dark bg-gold-light" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DashboardInsightsGroup insights={INSIGHTS} />
      </div>
      <DocList docs={legalDocs} cat={cat} title="Legal and Client Documents" emptyText="No legal documents yet" />
    </DashboardShell>
  )
}
