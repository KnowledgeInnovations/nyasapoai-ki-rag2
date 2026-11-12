import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getMembership, getTenant } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { normalizeRole, isPlatformTenant } from '@/lib/roles'
import { isGraphConfigured } from '@/lib/sharepoint/graph'
import ConnectionsClient, { type ConnectionRow } from '@/components/app/ConnectionsClient'

export const metadata: Metadata = { title: 'Connections — Nyansa AI' }

/**
 * Where a Senior connects an outside document library.
 *
 * Senior only, matching /api/connections/sharepoint. Connecting a library
 * is a standing grant — every file in it, and every file added to it
 * later, becomes answerable here — so it sits at the same level as
 * changing who may read a Confidential document.
 */
export default async function ConnectionsPage() {
  const membership = await getMembership()
  if (!membership) redirect('/auth/login')
  if (normalizeRole(membership.role) !== 'senior') redirect('/settings')

  const tenant = await getTenant(membership.tenant_id)
  if (isPlatformTenant(tenant)) redirect('/admin/tenants')

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Tolerates migration 053 not having run: the tables are absent, the
  // query errors, and the page renders with no connections rather than
  // failing. The same shape the logo and paid_until lookups use.
  const { data: connections } = await service
    .from('sharepoint_connections')
    .select('*')
    .eq('tenant_id', membership.tenant_id)
    .order('created_at', { ascending: true })

  const rows = (connections ?? []) as unknown as ConnectionRow[]

  // How many documents each connection has actually brought in. Shown
  // because "connected" and "working" are different claims, and a
  // connection that has imported nothing for a week is the thing worth
  // noticing on this screen.
  const counts: Record<string, number> = {}
  if (rows.length) {
    const { data: items } = await service
      .from('sharepoint_items')
      .select('connection_id')
      .in('connection_id', rows.map(r => r.id))
    for (const item of items ?? []) {
      const key = (item as { connection_id: string }).connection_id
      counts[key] = (counts[key] ?? 0) + 1
    }
  }

  return (
    <ConnectionsClient
      connections={rows}
      fileCounts={counts}
      configured={isGraphConfigured()}
    />
  )
}
