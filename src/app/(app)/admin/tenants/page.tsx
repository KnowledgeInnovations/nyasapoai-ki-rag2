import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getMembership, getTenant } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import TenantsClient from '@/components/app/TenantsClient'

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
    .select('id, name, subdomain, plan, created_at, is_platform, memberships(count)')
    .eq('is_platform', false)
    .order('created_at', { ascending: false })

  type Row = {
    id: string
    name: string
    subdomain: string
    plan: string
    created_at: string
    is_platform: boolean
    memberships: { count: number }[]
  }

  const rows = (tenants ?? []) as unknown as Row[]

  const tenantRows = rows.map(t => ({
    id: t.id,
    name: t.name,
    subdomain: t.subdomain,
    plan: t.plan,
    createdAt: t.created_at,
    memberCount: t.memberships?.[0]?.count ?? 0,
    isPlatform: t.is_platform,
  }))

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Tenants</h1>
        <p className="mt-1 text-sm text-gray-500">All workspaces on the NyasapoAI platform.</p>
      </div>

      <TenantsClient tenants={tenantRows} />
    </div>
  )
}
