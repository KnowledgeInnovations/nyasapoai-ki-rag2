import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMembership, getTenant, getUser } from '@/lib/supabase/server'
import { normalizePlan } from '@/lib/plans'
import { normalizeStatus, STATUS_LABELS } from '@/lib/workspaceStatus'
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Platform-admin only: permanently delete a tenant and everything in it
// (memberships, documents, chunks, etc. cascade via FK; storage files are
// removed best-effort).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenant = await getTenant(membership.tenant_id)
  if (membership.role !== 'senior' || !tenant?.is_platform) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (id === tenant.id) {
    return NextResponse.json({ error: 'Cannot delete the platform tenant' }, { status: 400 })
  }

  const service = svc()

  const { data: target } = await service
    .from('tenants')
    .select('id, is_platform')
    .eq('id', id)
    .maybeSingle()

  if (!target) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (target.is_platform) {
    return NextResponse.json({ error: 'Cannot delete the platform tenant' }, { status: 400 })
  }

  const { data: docs } = await service
    .from('documents')
    .select('file_path')
    .eq('tenant_id', id)

  const { error: deleteError } = await service.from('tenants').delete().eq('id', id)
  if (deleteError) {
    console.error('Tenant delete error:', deleteError)
    return NextResponse.json({ error: 'Failed to delete tenant' }, { status: 500 })
  }

  // Deleting a workspace deletes its files. A failure here leaves every
  // one of that workspace's documents in the bucket after the records
  // pointing at them are gone — the whole workspace's content, orphaned
  // and unreachable through the product. Reported, not discarded.
  const filePaths = (docs ?? []).map(d => d.file_path).filter((p): p is string => !!p)
  let orphanedFiles = 0
  if (filePaths.length > 0) {
    const { error: storageError } = await service.storage.from('documents').remove(filePaths)
    if (storageError) {
      orphanedFiles = filePaths.length
      console.error(
        `[tenants] ORPHANED FILES: workspace ${id} was deleted but its ${filePaths.length} ` +
        `stored file(s) could not be removed: ${storageError.message}`,
      )
    }
  }

  return NextResponse.json({
    success: true,
    ...(orphanedFiles
      ? { warning: `The workspace was deleted, but ${orphanedFiles} stored file(s) could not be removed. This has been logged for an administrator to clear.` }
      : {}),
  })
}

/**
 * Platform-admin only: change a workspace's plan or lifecycle status.
 *
 * This is how an Enterprise enquiry becomes an Enterprise workspace, and how
 * a paid workspace is activated once payment has been settled. Before this
 * existed, `plan` could only be changed by editing the database by hand, so
 * every sale ended in someone running SQL against production.
 *
 * Suspension is reversible and never deletes anything — see migration 034.
 * Only these two fields are writable: the name and subdomain are identity,
 * and a subdomain change would break every link and bookmark a workspace has.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const actingTenant = await getTenant(membership.tenant_id)
  if (membership.role !== 'senior' || !actingTenant?.is_platform) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { plan: rawPlan, status: rawStatus } = (body ?? {}) as { plan?: string; status?: string }

  const update: { plan?: string; status?: string } = {}
  // normalizePlan/normalizeStatus fall back to a default for anything they do
  // not recognise, which would quietly downgrade a workspace on a typo. Only
  // accept a value that survives the round trip unchanged.
  if (rawPlan !== undefined) {
    const plan = normalizePlan(rawPlan)
    if (plan !== String(rawPlan).trim().toLowerCase()) {
      return NextResponse.json({ error: `Unknown plan "${rawPlan}".` }, { status: 400 })
    }
    update.plan = plan
  }
  if (rawStatus !== undefined) {
    const status = normalizeStatus(rawStatus)
    if (status !== String(rawStatus).trim().toLowerCase()) {
      return NextResponse.json({ error: `Unknown status "${rawStatus}".` }, { status: 400 })
    }
    update.status = status
  }
  if (!Object.keys(update).length) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  }

  const service = svc()
  // The current values, read before the update: a change is only meaningful
  // in the log if it says what it changed from.
  const { data: target } = await service
    .from('tenants').select('id, name, plan, status, is_platform').eq('id', id).maybeSingle()
  if (!target) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  if (target.is_platform) {
    return NextResponse.json({ error: 'The platform workspace has no plan to change.' }, { status: 400 })
  }

  const { data: updated, error } = await service
    .from('tenants')
    .update(update)
    .eq('id', id)
    .select('id, name, subdomain, plan, status')
    .single()

  if (error || !updated) {
    console.error('[tenants] plan/status update failed:', error?.message)
    return NextResponse.json({ error: 'Could not update the workspace.' }, { status: 500 })
  }

  // Two separate entries when both change, because they are two different
  // decisions and each is asked about on its own.
  if (update.plan && update.plan !== target.plan) {
    await recordAudit({
      tenantId: id,
      userId: (await getUser())?.id ?? null,
      action: AUDIT_ACTIONS.WORKSPACE_PLAN,
      resourceType: 'workspace',
      resourceId: id,
      metadata: { from: target.plan, to: update.plan, by: 'platform admin' },
    })
  }
  if (update.status && update.status !== normalizeStatus(target.status)) {
    await recordAudit({
      tenantId: id,
      userId: (await getUser())?.id ?? null,
      action: AUDIT_ACTIONS.WORKSPACE_STATUS,
      resourceType: 'workspace',
      resourceId: id,
      metadata: { from: normalizeStatus(target.status), to: update.status, by: 'platform admin' },
    })
  }

  console.log(
    `[tenants] ${target.name} -> ` +
    [update.plan && `plan ${update.plan}`, update.status && `status ${update.status}`]
      .filter(Boolean).join(', '),
  )

  return NextResponse.json({
    tenant: updated,
    statusLabel: STATUS_LABELS[normalizeStatus(updated.status)],
  })
}
