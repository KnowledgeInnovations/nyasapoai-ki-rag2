import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMembership, getTenant } from '@/lib/supabase/server'
import { normalizeRole } from '@/lib/roles'
import type { AuditRow } from '@/lib/audit'

/**
 * Reads a workspace's audit log.
 *
 * Who may read it:
 *   - a Senior member of that workspace, which includes whoever created it,
 *     since the creator is made Senior on the way in;
 *   - a platform admin, for any workspace, by passing ?tenantId=.
 *
 * Middle and Junior members get nothing. That matches the audit_logs_select
 * policy in the schema, and is enforced here as well rather than relied upon:
 * this route reads with the service role to resolve actor names across the
 * users table, and the service role bypasses row-level security entirely. The
 * policy is the floor, not the gate.
 */

const PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function GET(request: NextRequest) {
  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ownTenant = await getTenant(membership.tenant_id)
  const isPlatformAdmin = normalizeRole(membership.role) === 'senior' && ownTenant?.is_platform === true

  const url = new URL(request.url)
  const requestedTenant = url.searchParams.get('tenantId')

  // A workspace other than your own is readable only by a platform admin.
  let tenantId = membership.tenant_id
  if (requestedTenant && requestedTenant !== membership.tenant_id) {
    if (!isPlatformAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    tenantId = requestedTenant
  }

  // Your own workspace: Senior only. A platform admin reading their own
  // workspace is a Senior there too, so this covers both.
  if (tenantId === membership.tenant_id && normalizeRole(membership.role) !== 'senior') {
    return NextResponse.json({
      error: 'The audit log is available to Senior users.',
    }, { status: 403 })
  }

  const limit = Math.min(
    Math.max(Number(url.searchParams.get('limit')) || PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  )
  // Cursor rather than offset: the log only grows at the head, so an offset
  // page shifts under the reader as new entries arrive.
  const before = url.searchParams.get('before')

  const service = svc()
  let query = service
    .from('audit_logs')
    .select('id, user_id, action, resource_type, resource_id, metadata, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit + 1)
  if (before) query = query.lt('created_at', before)

  const { data, error } = await query
  if (error) {
    console.error('[audit] read failed:', error.message)
    return NextResponse.json({ error: 'Could not read the audit log.' }, { status: 500 })
  }

  const rows = data ?? []
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  // Resolve who did each thing, in one query rather than per row.
  const actorIds = [...new Set(page.map(r => r.user_id).filter((v): v is string => !!v))]
  const actors = new Map<string, { name: string; email: string }>()
  if (actorIds.length) {
    const { data: users } = await service
      .from('users').select('id, name, email').in('id', actorIds)
    for (const u of users ?? []) {
      actors.set(u.id, { name: u.name ?? '', email: u.email ?? '' })
    }
  }

  const entries: AuditRow[] = page.map(r => {
    const actor = r.user_id ? actors.get(r.user_id) : undefined
    return {
      id: r.id,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      createdAt: r.created_at,
      // A null actor is the system acting on its own — a scheduled retrain,
      // say. Named as such rather than left blank, so it does not read as
      // missing data.
      actor: r.user_id
        ? { id: r.user_id, name: actor?.name || '', email: actor?.email || 'Removed user' }
        : null,
    }
  })

  return NextResponse.json({
    entries,
    // The raw row carries created_at; entries carry createdAt. Reading the
    // wrong one here would hand back an undefined cursor and silently end
    // pagination at the first page.
    nextBefore: hasMore ? entries[entries.length - 1]?.createdAt ?? null : null,
    canReadAllWorkspaces: isPlatformAdmin,
  })
}
