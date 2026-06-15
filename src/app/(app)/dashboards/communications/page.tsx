import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Radio, Mail, MessageSquare, Users } from 'lucide-react'
import { getMembership, createClient } from '@/lib/supabase/server'
import { canAccessDashboards } from '@/lib/roles'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import DashboardShell from '@/components/app/DashboardShell'
import DashboardInsightsGroup from '@/components/app/DashboardInsightsGroup'
import { StatCard } from '@/components/app/DashboardWidgets'

export const metadata: Metadata = { title: 'Communications Dashboard - NyasapoAI' }


function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const INSIGHTS = [
  { label: 'Key Announcements', question: 'What are the most important internal announcements, policy changes, or directives that have been communicated recently according to the uploaded documents?' },
  { label: 'Staff Engagement',  question: 'What do the documents reveal about staff engagement, morale, feedback, or participation in company programmes? Are there any concerns or positive signals?' },
  { label: 'Comms Gaps',        question: 'Are there any issues with communication breakdown, low acknowledgment rates, unresponded queries, or information silos mentioned in the documents?' },
]

export default async function CommunicationsDashboard() {
  const membership = await getMembership()
  if (!membership || !canAccessDashboards(membership.role)) redirect('/ask')

  const supabase = await createClient()
  const service  = svc()
  const tid      = membership.tenant_id
  const weekAgo  = new Date(Date.now() - 7 * 86_400_000).toISOString()

  const [
    { count: docCount },
    { count: convsWeek },
    { count: convsTotal },
  ] = await Promise.all([
    service.from('documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).eq('status', 'ready'),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', weekAgo),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', tid),
  ])

  const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <DashboardShell title="Communications Dashboard" description="Internal announcements, staff engagement, and communication effectiveness from your documents." lastUpdated={now}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Radio}         label="Documents Indexed"   value={String(docCount ?? 0)}   sub="Workspace knowledge"           live color="text-blue-600 bg-blue-50" />
        <StatCard icon={MessageSquare} label="AI Queries (7 days)" value={String(convsWeek ?? 0)}  sub={`${convsTotal ?? 0} all-time`} live color="text-brand bg-brand-light" />
        <StatCard icon={Mail}          label="Key Announcements"   value="AI"                      sub="Analysed from documents"       live color="text-indigo-600 bg-indigo-50" />
        <StatCard icon={Users}         label="Staff Engagement"    value="AI"                      sub="Analysed from documents"       live color="text-green-600 bg-green-50" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DashboardInsightsGroup insights={INSIGHTS} />
      </div>
    </DashboardShell>
  )
}
