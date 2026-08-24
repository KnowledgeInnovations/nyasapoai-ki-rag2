import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FileText, MessageSquare, AlertTriangle, Sparkles } from 'lucide-react'
import { getMembership, getTenant, createClient } from '@/lib/supabase/server'
import { canAccessDashboards, isPlatformTenant } from '@/lib/roles'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { StatCard } from '@/components/app/DashboardWidgets'
import AdaptiveDashboard from '@/components/app/AdaptiveDashboard'

export const metadata: Metadata = { title: 'Dashboard - Nyansa AI' }

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// One self-organizing dashboard, replacing the previous 8 fixed department
// pages (Sales/Marketing/HR/Finance/Executive/Development/Client-Service/
// Communications) — that template assumed every tenant maps onto a
// conventional org chart, which most don't. This page keeps the tenant-
// agnostic stat row (documents/queries/risks apply to any tenant) and hands
// the rest to AdaptiveDashboard, which discovers real themes from THIS
// tenant's own documents instead of a fixed department list.
export default async function DashboardPage() {
  const membership = await getMembership()
  if (!membership || !canAccessDashboards(membership.role)) redirect('/ask')
  if (isPlatformTenant(await getTenant(membership.tenant_id))) redirect('/admin/tenants')

  const supabase = await createClient()
  const service = svc()
  const tid = membership.tenant_id
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
    supabase.from('conversations').select('id, risks').eq('tenant_id', tid).not('risks', 'eq', '[]').order('created_at', { ascending: false }).limit(20),
  ])

  const totalRisks = (riskyConvs ?? []).reduce((a, c) => a + (c.risks?.length ?? 0), 0)
  const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-editorial truncate text-xl font-normal text-gray-900">Dashboard</h1>
          <p className="hidden truncate text-xs text-gray-500 sm:block">Organized around what your own documents actually cover.</p>
        </div>
        <span className="shrink-0 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-400 shadow-sm">
          {now}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={FileText}      label="Documents Indexed"    value={String(docCount ?? 0)}   sub="Available for AI analysis"     live color="text-gold-dark bg-gold-light" />
        <StatCard icon={MessageSquare} label="AI Queries (30 days)" value={String(convsMonth ?? 0)} sub={`${convsTotal ?? 0} all-time`}  live color="text-brand bg-brand-light" />
        <StatCard icon={AlertTriangle} label="Risks Flagged"        value={String(totalRisks)}      sub="Identified in AI answers"       live color="text-amber-600 bg-amber-50" />
        <StatCard icon={Sparkles}      label="AI-Discovered Themes" value="Live"                     sub="Self-organized below"           live color="text-green-600 bg-green-50" />
      </div>

      <AdaptiveDashboard />
    </div>
  )
}
