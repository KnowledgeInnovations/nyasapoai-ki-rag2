import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FileText, MessageSquare, TrendingUp, Target } from 'lucide-react'
import { getMembership, getTenant, createClient } from '@/lib/supabase/server'
import { canAccessDashboards, isPlatformTenant } from '@/lib/roles'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { CATEGORIES } from '@/lib/documentCategories'
import DashboardShell from '@/components/app/DashboardShell'
import DashboardInsightsGroup from '@/components/app/DashboardInsightsGroup'
import { StatCard, DocList } from '@/components/app/DashboardWidgets'

export const metadata: Metadata = { title: 'Sales Dashboard - NyasapoAI' }


function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const INSIGHTS = [
  { label: 'Contracts & Deals',       question: 'How many contracts have been signed? What are the total values, client names, property types, and key terms mentioned in the uploaded contracts?' },
  { label: 'Sales Performance',        question: 'Are we hitting our sales targets? What does the sales performance look like compared to any targets, projections, or previous periods mentioned in the documents?' },
  { label: 'Pipeline & Reservations',  question: 'What leads, reservations, pending deals, or upcoming sales are mentioned in the documents? What is the conversion outlook?' },
]

export default async function SalesDashboard() {
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
    { count: contractCount },
    { count: convsWeek },
    { count: convsTotal },
    { data: contractDocs },
  ] = await Promise.all([
    service.from('documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).eq('department', 'contracts').eq('status', 'ready'),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', weekAgo),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', tid),
    service.from('documents').select('id, title, department, status, created_at').eq('tenant_id', tid).eq('department', 'contracts').order('created_at', { ascending: false }).limit(6),
  ])

  const cat = CATEGORIES.find(c => c.value === 'contracts')
  const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <DashboardShell title="Sales Dashboard" description="Contracts, pipeline, reservations, and sales performance from your documents." lastUpdated={now}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={FileText}      label="Contracts Indexed"   value={String(contractCount ?? 0)} sub="Ready for AI search"          live color="text-amber-600 bg-amber-50" />
        <StatCard icon={MessageSquare} label="AI Queries (7 days)" value={String(convsWeek ?? 0)}     sub={`${convsTotal ?? 0} all-time`}  live color="text-brand bg-brand-light" />
        <StatCard icon={TrendingUp}    label="Sales Pipeline"      value="AI"                          sub="Analysed from documents"       live color="text-green-600 bg-green-50" />
        <StatCard icon={Target}        label="Target vs Actual"    value="AI"                          sub="Analysed from documents"       live color="text-purple-600 bg-purple-50" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DashboardInsightsGroup insights={INSIGHTS} />
      </div>
      <DocList docs={contractDocs} cat={cat} title="Sales Contracts" emptyText="No contracts uploaded yet" />
    </DashboardShell>
  )
}
