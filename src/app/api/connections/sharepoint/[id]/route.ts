import { NextRequest, NextResponse } from 'next/server'
import { requireConnectionAdmin, svc, SENSITIVITIES } from '../guard'
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit'

/** Changing or removing one connected library. */

export const dynamic = 'force-dynamic'

async function connectionFor(tenantId: string, id: string) {
  const { data } = await svc()
    .from('sharepoint_connections')
    .select('*')
    // Scoped to the workspace as well as the id: an id alone would let one
    // workspace's Senior change another's connection by guessing a uuid.
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  return data
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireConnectionAdmin()
  if ('error' in gate) return gate.error
  const { id } = await params

  const existing = await connectionFor(gate.tenantId, id)
  if (!existing) return NextResponse.json({ error: 'That connection does not exist.' }, { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Could not read the request.' }, { status: 400 })
  }
  const { enabled, sensitivity, displayName } = (body ?? {}) as Record<string, unknown>

  const patch: Record<string, unknown> = {}
  const changes: Record<string, unknown> = {}

  if (typeof enabled === 'boolean' && enabled !== existing.enabled) {
    patch.enabled = enabled
    changes.enabled = enabled
  }
  if (typeof displayName === 'string' && displayName.trim() && displayName.trim() !== existing.display_name) {
    patch.display_name = displayName.trim().slice(0, 200)
    changes.name = patch.display_name
  }
  if (typeof sensitivity === 'string') {
    const level = sensitivity.trim().toLowerCase()
    if (!(SENSITIVITIES as readonly string[]).includes(level)) {
      return NextResponse.json({
        error: `"${level}" is not a sensitivity level. Choose one of: ${SENSITIVITIES.join(', ')}.`,
      }, { status: 400 })
    }
    if (level !== existing.sensitivity) {
      patch.sensitivity = level
      changes.sensitivity = level
    }
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  }

  patch.updated_at = new Date().toISOString()
  const service = svc()
  const { data, error } = await service
    .from('sharepoint_connections')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: `Could not save the change: ${error.message}` }, { status: 500 })
  }

  // Raising or lowering the level has to reach the documents already
  // imported, not just the ones imported next. Leaving the existing rows
  // at the old level is the bug this whole mechanism exists to avoid: the
  // screen would say Confidential while a Junior could still read them.
  let relabelled = 0
  if (typeof patch.sensitivity === 'string') {
    const { data: items } = await service
      .from('sharepoint_items').select('document_id').eq('connection_id', id)
    const documentIds = (items ?? []).map(i => i.document_id).filter((d): d is string => !!d)
    if (documentIds.length) {
      const { error: relabelError, count } = await service
        .from('documents')
        .update({ sensitivity: patch.sensitivity }, { count: 'exact' })
        .in('id', documentIds)
        .eq('tenant_id', gate.tenantId)
      if (relabelError) {
        return NextResponse.json({
          error: `The connection was changed, but the ${documentIds.length} document(s) already imported could not be relabelled: ${relabelError.message}. They are still at the old level — change it again to retry.`,
        }, { status: 500 })
      }
      relabelled = count ?? documentIds.length
    }
  }

  await recordAudit({
    tenantId:     gate.tenantId,
    userId:       gate.userId,
    action:       AUDIT_ACTIONS.CONNECTION_CHANGED,
    resourceType: 'sharepoint_connection',
    resourceId:   id,
    metadata:     { library: existing.display_name, changes, documentsRelabelled: relabelled },
  })

  return NextResponse.json({ connection: data, relabelled })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireConnectionAdmin()
  if ('error' in gate) return gate.error
  const { id } = await params

  const existing = await connectionFor(gate.tenantId, id)
  if (!existing) return NextResponse.json({ error: 'That connection does not exist.' }, { status: 404 })

  // Documents are KEPT unless removal is asked for explicitly.
  //
  // Disconnecting answers "stop syncing this", which is not the same
  // question as "delete the work already done". Someone rotating a tenant
  // id or re-pointing a connection would otherwise destroy every document
  // imported from it, along with its chunks and extracted facts, by
  // clicking the obvious button. So the default keeps them and the screen
  // asks which is meant.
  const url = new URL(request.url)
  const removeDocuments = url.searchParams.get('removeDocuments') === '1'

  const service = svc()
  let documentsRemoved = 0

  if (removeDocuments) {
    const { data: items } = await service
      .from('sharepoint_items').select('document_id').eq('connection_id', id)
    const documentIds = (items ?? []).map(i => i.document_id).filter((d): d is string => !!d)

    for (const documentId of documentIds) {
      // Scoped by tenant on every statement: a mapping row pointing at
      // another workspace's document must not be able to delete it.
      const { data: doc } = await service
        .from('documents').select('file_path').eq('id', documentId)
        .eq('tenant_id', gate.tenantId).maybeSingle()
      if (!doc) continue

      await service.from('document_chunks').delete().eq('document_id', documentId)
      const { error: deleteError } = await service
        .from('documents').delete().eq('id', documentId).eq('tenant_id', gate.tenantId)
      if (deleteError) continue
      documentsRemoved++
      if (doc.file_path) {
        await service.storage.from('documents').remove([doc.file_path]).catch(() => {})
      }
    }
  }

  // sharepoint_items goes with it on cascade (migration 053). The
  // documents, when kept, simply stop being managed — they stay in the
  // workspace as ordinary documents.
  const { error } = await service
    .from('sharepoint_connections').delete().eq('id', id).eq('tenant_id', gate.tenantId)
  if (error) {
    return NextResponse.json({ error: `Could not disconnect: ${error.message}` }, { status: 500 })
  }

  await recordAudit({
    tenantId:     gate.tenantId,
    userId:       gate.userId,
    action:       AUDIT_ACTIONS.CONNECTION_REMOVED,
    resourceType: 'sharepoint_connection',
    resourceId:   id,
    metadata:     { library: existing.display_name, documentsRemoved: removeDocuments ? documentsRemoved : 0 },
  })

  return NextResponse.json({ ok: true, documentsRemoved })
}
