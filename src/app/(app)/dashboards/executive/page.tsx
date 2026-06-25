import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FileText, MessageSquare, AlertTriangle, TrendingUp } from 'lucide-react'
import { getMembership, getTenant, createClient } from '@/lib/supabase/server'
import { canAccessDashboards, isPlatformTenant } from '@/lib/roles'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import DashboardShell from '@/components/app/DashboardShell'
import DashboardInsightsGroup from '@/components/app/DashboardInsightsGroup'
import { StatCard } from '@/components/app/DashboardWidgets'

export const metadata: Metadata = { title: 'Executive Dashboard - NyasapoAI' }


function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const INSIGHTS = [
  { label: 'Company Overview',    question: 'Summarise the overall business performance, active projects, financial status, and any strategic decisions mentioned across all uploaded documents. Give specific figures where available.' },
  { label: 'Urgent Attention',    question: 'What are the most urgent issues, outstanding approvals, overdue items, or risks that leadership needs to address immediately based on the documents?' },
  { label: 'Growth & Highlights', question: 'What project completions, revenue wins, new contracts signed, or positive developments are visible in the uploaded documents?' },
]

export default async function ExecutiveDashboard() {
  const membership = await getMembership()
  if (!membership || !canAccessDashboards(membership.role)) redirect('/ask')
  if (isPlatformTenant(await getTenant(membership.tenant_id))) redirect('/training')

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
    { data: riskyConvs },
  ] = await Promise.all([
    service.from('documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).eq('status', 'ready'),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthAgo),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', tid),
    supabase.from('conversations').select('id, query, risks').eq('tenant_id', tid).not('risks', 'eq', '[]').order('created_at', { ascending: false }).limit(3),
  ])

  const totalRisks = (riskyConvs ?? []).reduce((a, c) => a + (c.risks?.length ?? 0), 0)
  const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <DashboardShell title="Executive Dashboard" description="Company-wide performance, risks, and strategic overview from your documents." lastUpdated={now}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={FileText}      label="Documents Indexed"    value={String(docCount ?? 0)}   sub="Available for AI analysis"     live color="text-indigo-600 bg-indigo-50" />
        <StatCard icon={MessageSquare} label="AI Queries (30 days)" value={String(convsMonth ?? 0)} sub={`${convsTotal ?? 0} all-time`}  live color="text-brand bg-brand-light" />
        <StatCard icon={AlertTriangle} label="Risks Flagged"        value={String(totalRisks)}      sub="Identified in AI answers"       live color="text-amber-600 bg-amber-50" />
        <StatCard icon={TrendingUp}    label="Active Insights"      value={docCount ? '3' : '0'}    sub="Live AI analysis below"         live color="text-green-600 bg-green-50" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DashboardInsightsGroup insights={INSIGHTS} />
      </div>
    </DashboardShell>
  )
}
