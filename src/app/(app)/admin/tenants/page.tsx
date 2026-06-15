import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getMembership, getTenant } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const metadata: Metadata = { title: 'Tenants — NyasapoAI' }

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export default async function TenantsPage() {
  const membership = await getMembership()
  if (!membership) redirect('/auth/setup-workspace')

  const tenant = await getTenant(membership.tenant_id)
  if (membership.role !== 'senior' || !tenant?.is_platform) redirect('/ask')

  const service = svc()
  const { data: tenants } = await service
    .from('tenants')
    .select('id, name, subdomain, plan, created_at, memberships(count)')
    .order('created_at', { ascending: false })

  type Row = {
    id: string
    name: string
    subdomain: string
    plan: string
    created_at: string
    memberships: { count: number }[]
  }

  const rows = (tenants ?? []) as unknown as Row[]

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Tenants</h1>
        <p className="mt-1 text-sm text-gray-500">All workspaces on the NyasapoAI platform.</p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
          <h2 className="text-sm font-bold text-gray-800">Workspaces</h2>
          <p className="mt-0.5 text-xs text-gray-500">{rows.length} {rows.length === 1 ? 'tenant' : 'tenants'} total.</p>
        </div>
        <div className="divide-y divide-gray-100">
          {rows.map(t => (
            <div key={t.id} className="flex items-center gap-4 px-6 py-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{t.name}</p>
                <p className="truncate text-xs text-gray-500">{t.subdomain}.nyasapoai.com</p>
              </div>
              <span className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                {t.plan}
              </span>
              <span className="w-20 shrink-0 text-right text-sm text-gray-500">
                {t.memberships?.[0]?.count ?? 0} {(t.memberships?.[0]?.count ?? 0) === 1 ? 'member' : 'members'}
              </span>
              <span className="w-28 shrink-0 text-right text-xs text-gray-400">
                {new Date(t.created_at).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
