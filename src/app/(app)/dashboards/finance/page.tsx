import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Banknote, TrendingDown, MessageSquare, PiggyBank } from 'lucide-react'
import { getMembership, getTenant, createClient } from '@/lib/supabase/server'
import { canAccessDashboards, isPlatformTenant } from '@/lib/roles'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { CATEGORIES } from '@/lib/documentCategories'
import DashboardShell from '@/components/app/DashboardShell'
import DashboardInsightsGroup from '@/components/app/DashboardInsightsGroup'
import { StatCard, DocList } from '@/components/app/DashboardWidgets'

export const metadata: Metadata = { title: 'Finance Dashboard - Nyansa AI' }


function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const INSIGHTS = [
  { label: 'Revenue & Collections', question: 'What revenue has been collected, what is pending, and what are the total receivables mentioned in the uploaded financial documents? Give specific figures, dates, and project names.' },
  { label: 'Outstanding Payments',  question: 'What invoices, payments, or debts are outstanding? Who owes money, how much, and for how long? Are any accounts overdue according to the financial documents?' },
  { label: 'Financial Risks',       question: 'What financial risks, budget overruns, cash flow concerns, or unusual costs are mentioned in the documents? Is the company in a healthy or stressed financial position?' },
]

export default async function FinanceDashboard() {
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
    { count: financeDocCount },
    { count: convsMonth },
    { count: convsTotal },
    { data: financeDocs },
  ] = await Promise.all([
    service.from('documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).eq('department', 'finance').eq('status', 'ready'),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthAgo),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', tid),
    service.from('documents').select('id, title, department, status, created_at').eq('tenant_id', tid).eq('department', 'finance').order('created_at', { ascending: false }).limit(6),
  ])

  const cat = CATEGORIES.find(c => c.value === 'finance')
  const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <DashboardShell title="Finance Dashboard" description="Revenue, payments, cash flow, and financial risks extracted from your documents." lastUpdated={now}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Banknote}      label="Finance Documents"    value={String(financeDocCount ?? 0)} sub="Indexed and searchable"       live color="text-green-600 bg-green-50" />
        <StatCard icon={MessageSquare} label="AI Queries (30 days)" value={String(convsMonth ?? 0)}      sub={`${convsTotal ?? 0} all-time`} live color="text-brand bg-brand-light" />
        <StatCard icon={PiggyBank}     label="Revenue Status"       value="AI"                           sub="Analysed from documents"       live color="text-gold-dark bg-gold-light" />
        <StatCard icon={TrendingDown}  label="Outstanding Payments" value="AI"                           sub="Analysed from documents"       live color="text-red-600 bg-red-50" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DashboardInsightsGroup insights={INSIGHTS} />
      </div>
      <DocList docs={financeDocs} cat={cat} title="Finance Documents" emptyText="No finance documents yet" />
    </DashboardShell>
  )
}
