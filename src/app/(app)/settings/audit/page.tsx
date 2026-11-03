import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMembership, getTenant } from '@/lib/supabase/server'
import { normalizeRole } from '@/lib/roles'
import AuditLogClient from '@/components/app/AuditLogClient'

export const metadata: Metadata = { title: 'Audit log — Nyansa AI' }

/**
 * Senior users only, matching the audit_logs_select policy in the schema and
 * the check in /api/audit. A platform admin additionally gets a workspace
 * picker, because the whole platform is theirs to answer for.
 */
export default async function AuditLogPage() {
  const membership = await getMembership()
  if (!membership) redirect('/auth/login')
  if (normalizeRole(membership.role) !== 'senior') redirect('/settings')

  const tenant = await getTenant(membership.tenant_id)
  const isPlatformAdmin = tenant?.is_platform === true

  // Only a platform admin is offered other workspaces; for everyone else the
  // list is absent, not merely hidden.
  let workspaces: { id: string; name: string }[] = []
  if (isPlatformAdmin) {
    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const { data } = await service
      .from('tenants').select('id, name').order('name')
    workspaces = data ?? []
  }

  return (
    <AuditLogClient
      workspaces={isPlatformAdmin ? workspaces : undefined}
      currentTenantId={membership.tenant_id}
      currentTenantName={tenant?.name ?? 'this workspace'}
    />
  )
}
