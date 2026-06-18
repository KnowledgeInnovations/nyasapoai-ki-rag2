import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Megaphone, MessageSquare, TrendingUp, BarChart3 } from 'lucide-react'
import { getMembership, getTenant, createClient } from '@/lib/supabase/server'
import { canAccessDashboards, isPlatformTenant } from '@/lib/roles'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import DashboardShell from '@/components/app/DashboardShell'
import DashboardInsightsGroup from '@/components/app/DashboardInsightsGroup'
import { StatCard } from '@/components/app/DashboardWidgets'

export const metadata: Metadata = { title: 'Marketing Dashboard - NyasapoAI' }


function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const INSIGHTS = [
  { label: 'Campaign Performance', question: 'What marketing campaigns, promotions, or advertising activities are mentioned in the documents? What were the results, reach, and conversion figures?' },
  { label: 'Lead Generation',      question: 'How many leads were generated? What are the lead sources, quality, and conversion rates mentioned in marketing or sales documents?' },
  { label: 'Marketing ROI',        question: 'What is the return on marketing investment? Are there any cost-per-lead, cost-per-acquisition, or campaign budget vs results figures in the documents?' },
]

export default async function MarketingDashboard() {
  const membership = await getMembership()
  if (!membership || !canAccessDashboards(membership.role)) redirect('/ask')
  if (isPlatformTenant(await getTenant(membership.tenant_id))) redirect('/training')

  const supabase = await createClient()
  const service  = svc()
  const tid      = membership.tenant_id
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
    <DashboardShell title="Marketing Dashboard" description="Campaign performance, lead generation, and marketing ROI from your documents." lastUpdated={now}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Megaphone}     label="Documents Indexed"    value={String(docCount ?? 0)}   sub="Workspace knowledge"           live color="text-purple-600 bg-purple-50" />
        <StatCard icon={MessageSquare} label="AI Queries (30 days)" value={String(convsMonth ?? 0)} sub={`${convsTotal ?? 0} all-time`} live color="text-brand bg-brand-light" />
        <StatCard icon={TrendingUp}    label="Lead Generation"      value="AI"                      sub="Analysed from documents"       live color="text-amber-600 bg-amber-50" />
        <StatCard icon={BarChart3}     label="Marketing ROI"        value="AI"                      sub="Analysed from documents"       live color="text-green-600 bg-green-50" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DashboardInsightsGroup insights={INSIGHTS} />
      </div>
    </DashboardShell>
  )
}
