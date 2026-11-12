/**
 * Keeping a workspace in step with a SharePoint library.
 *
 * The shape of a sync run:
 *
 *   1. ask the change feed what has changed since last time
 *   2. for each file, skip it if its version marker is unchanged
 *   3. otherwise fetch the bytes, put them in storage, and hand the
 *      document to the existing training pipeline
 *   4. for each deletion, remove the document it produced
 *   5. store the new cursor
 *
 * Step 3 is the whole reason this is small. Reading a document — pulling
 * text out of a PDF, splitting it, embedding it, extracting facts — is
 * already built, already has its own budget handling, and is already the
 * most tested path in the product. The connector does not reimplement any
 * of it; it puts a file where an upload would have put it and triggers
 * the same training route the retry cron uses.
 *
 * ── Why it stops early on purpose ────────────────────────────────────
 * A first import of a large library will not finish in one run, and
 * pretending otherwise produces the failure this codebase has already
 * had once: a pass that spends its whole budget and records nothing. So a
 * run takes a time budget, stops cleanly when it is spent, stores its
 * cursor, and reports itself as 'partial'. Partial is a normal outcome.
 * The next run resumes exactly where it stopped.
 */

import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  getDeltaPage, downloadItem, isImportableFile, GraphError,
  type GraphCredentials, type GraphDriveItem,
} from './graph'
import { limitsFor, canAddDocument, canStore, canUploadFile } from '@/lib/plans'

export interface SharePointConnection {
  id: string
  tenant_id: string
  display_name: string
  azure_tenant_id: string
  site_id: string
  drive_id: string
  sensitivity: string
  department: string | null
  connected_by: string | null
  delta_link: string | null
  enabled: boolean
}

export interface SyncResult {
  connectionId: string
  status: 'ok' | 'partial' | 'failed'
  imported: number
  updated: number
  deleted: number
  skipped: number
  /** Files declined by a plan limit, with the reason. */
  refused: { name: string; reason: string }[]
  detail: string
  /** True when the cursor had expired and the library was re-read. */
  resynced: boolean
}

/** How long one run may spend, leaving room to record its progress. */
export const SYNC_BUDGET_MS = 240_000

/**
 * Stop starting new files with less than this left.
 *
 * Downloading a file and then being killed before the document row is
 * written is the one outcome worth avoiding: it spends the bandwidth and
 * leaves nothing behind.
 */
const PER_FILE_RESERVE_MS = 25_000

function svc(): SupabaseClient {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/** Where a connected file lands in storage. Mirrors the upload path's shape. */
function storagePathFor(connection: SharePointConnection, item: GraphDriveItem): string {
  const safeName = (item.name ?? 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120)
  return `${connection.tenant_id}/sharepoint/${connection.id}/${item.id}-${safeName}`
}

/**
 * Hand a stored file to the training pipeline.
 *
 * Called with the cron secret, exactly as the nightly retry does. The
 * alternative — reimplementing extraction here — would mean a second
 * ingestion path to keep correct, and the first one took months to get
 * right.
 */
async function triggerTraining(baseUrl: string, documentId: string): Promise<void> {
  // Set when exercising the connector against the sandbox. Reading a
  // document calls Anthropic and OpenAI and costs real money, and none of
  // it is what a sync test is checking — the pipeline it hands off to has
  // its own tests and its own budget handling. Never set in production.
  if (process.env.SHAREPOINT_SKIP_TRAINING === '1') {
    console.log(`[sharepoint] training skipped for ${documentId} (SHAREPOINT_SKIP_TRAINING=1)`)
    return
  }

  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error('CRON_SECRET is not set; the connector cannot trigger training.')

  const res = await fetch(`${baseUrl}/api/documents/${documentId}/train`, {
    method: 'POST',
    headers: { 'x-cron-secret': secret },
  })
  // /train streams its progress. Drain it so the run finishes before the
  // next file starts: two trainings at once would each assume they have
  // the whole rate limit to themselves.
  const reader = res.body?.getReader()
  if (reader) { for (;;) { const { done } = await reader.read(); if (done) break } }
}

/* ── one connection ───────────────────────────────────────────────── */

export async function syncConnection(
  connection: SharePointConnection,
  opts: { baseUrl: string; budgetMs?: number } ,
): Promise<SyncResult> {
  const service = svc()
  const startedAt = Date.now()
  const budget = opts.budgetMs ?? SYNC_BUDGET_MS
  const msLeft = () => budget - (Date.now() - startedAt)

  const creds: GraphCredentials = { azureTenantId: connection.azure_tenant_id }
  const result: SyncResult = {
    connectionId: connection.id,
    status: 'ok', imported: 0, updated: 0, deleted: 0, skipped: 0,
    refused: [], detail: '', resynced: false,
  }

  // The workspace's plan, read once. A library can hold far more than a
  // plan allows, and finding that out per file is the difference between
  // declining politely and half-importing something.
  const { data: tenant } = await service
    .from('tenants').select('plan').eq('id', connection.tenant_id).maybeSingle()
  const limits = limitsFor(tenant?.plan)

  const counts = await currentUsage(service, connection.tenant_id)
  let documentCount = counts.documents
  let storedBytes = counts.bytes

  let link = connection.delta_link
  let exhausted = false

  try {
    pages: for (;;) {
      let page
      try {
        page = await getDeltaPage(creds, connection.drive_id, link)
      } catch (e) {
        if (e instanceof GraphError && e.resyncRequired) {
          // The cursor is too old. Graph's answer is to read the library
          // again from the beginning; everything already imported will be
          // skipped by its unchanged version marker, so this is cheap
          // rather than catastrophic.
          console.log(`[sharepoint] cursor expired for ${connection.display_name}; re-reading the library`)
          result.resynced = true
          link = null
          page = await getDeltaPage(creds, connection.drive_id, null)
        } else {
          throw e
        }
      }

      for (const item of page.items) {
        if (msLeft() < PER_FILE_RESERVE_MS) { exhausted = true; break pages }

        if (item.deleted) {
          result.deleted += await removeItem(service, connection.id, item.id)
          continue
        }
        if (!isImportableFile(item)) { continue }

        const outcome = await importOne(service, connection, item, {
          creds, baseUrl: opts.baseUrl, limits,
          documentCount, storedBytes,
        })

        switch (outcome.kind) {
          case 'imported': result.imported++; documentCount++; storedBytes += outcome.bytes; break
          case 'updated':  result.updated++; break
          case 'skipped':  result.skipped++; break
          case 'refused':  result.refused.push({ name: item.name ?? item.id, reason: outcome.reason }); break
        }
      }

      if (page.deltaLink) { link = page.deltaLink; break }
      if (page.nextLink)  { link = page.nextLink; continue }
      break
    }
  } catch (e) {
    result.status = 'failed'
    result.detail = (e as Error).message.slice(0, 500)
    await recordRun(service, connection.id, link, result)
    return result
  }

  if (exhausted) {
    result.status = 'partial'
    result.detail = `Time budget reached. ${result.imported} imported, ${result.updated} updated, ` +
      `${result.skipped} unchanged so far. The rest continues on the next run.`
  } else {
    result.detail = `${result.imported} imported, ${result.updated} updated, ` +
      `${result.deleted} removed, ${result.skipped} unchanged.`
  }
  if (result.refused.length) {
    result.detail += ` ${result.refused.length} file(s) declined by plan limits.`
    if (result.status === 'ok') result.status = 'partial'
  }

  // Only store a cursor that marks a complete enumeration. A nextLink
  // stored as the resume point is correct; storing one as if it were a
  // deltaLink would make the next run think it was up to date.
  await recordRun(service, connection.id, link, result)
  return result
}

/* ── one file ─────────────────────────────────────────────────────── */

type ImportOutcome =
  | { kind: 'imported'; bytes: number }
  | { kind: 'updated' }
  | { kind: 'skipped' }
  | { kind: 'refused'; reason: string }

async function importOne(
  service: SupabaseClient,
  connection: SharePointConnection,
  item: GraphDriveItem,
  ctx: {
    creds: GraphCredentials
    baseUrl: string
    limits: ReturnType<typeof limitsFor>
    documentCount: number
    storedBytes: number
  },
): Promise<ImportOutcome> {
  const { data: existing } = await service
    .from('sharepoint_items')
    .select('id, document_id, etag')
    .eq('connection_id', connection.id)
    .eq('graph_item_id', item.id)
    .maybeSingle()

  // The single biggest saving in a routine sync. An unchanged file costs
  // one comparison here instead of a download, an extraction, an
  // embedding pass and a fact-extraction pass.
  if (existing?.document_id && existing.etag && existing.etag === item.eTag) {
    return { kind: 'skipped' }
  }

  const size = item.size ?? 0

  const fileCheck = canUploadFile(ctx.limits, size)
  if (!fileCheck.allowed) return { kind: 'refused', reason: fileCheck.reason ?? 'file too large' }

  if (!existing?.document_id) {
    const docCheck = canAddDocument(ctx.limits, ctx.documentCount)
    if (!docCheck.allowed) return { kind: 'refused', reason: docCheck.reason ?? 'document limit reached' }
  }
  const storeCheck = canStore(ctx.limits, ctx.storedBytes, size)
  if (!storeCheck.allowed) return { kind: 'refused', reason: storeCheck.reason ?? 'storage limit reached' }

  const { bytes, contentType } = await downloadItem(ctx.creds, connection.drive_id, item.id)
  const path = storagePathFor(connection, item)

  const { error: uploadError } = await service.storage
    .from('documents')
    .upload(path, bytes, { contentType, upsert: true })
  if (uploadError) throw new Error(`Could not store ${item.name}: ${uploadError.message}`)

  const title = (item.name ?? 'Untitled').replace(/\.[^.]+$/, '')
  const row = {
    tenant_id:   connection.tenant_id,
    uploaded_by: connection.connected_by,
    title,
    source:      item.name ?? item.id,
    department:  connection.department,
    sensitivity: connection.sensitivity,
    status:      'processing',
    file_path:   path,
    file_size:   bytes.length,
    mime_type:   contentType,
  }

  let documentId = existing?.document_id ?? null

  if (documentId) {
    // The file changed in SharePoint. Point the same document at the new
    // bytes and retrain it, rather than creating a second document and
    // leaving the workspace able to cite a superseded version.
    const { error } = await service.from('documents')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', documentId)
    if (error) throw new Error(`Could not update document for ${item.name}: ${error.message}`)
  } else {
    const { data, error } = await service.from('documents').insert(row).select('id').single()
    if (error || !data) throw new Error(`Could not create document for ${item.name}: ${error?.message}`)
    documentId = data.id
  }

  await service.from('sharepoint_items').upsert({
    connection_id:  connection.id,
    graph_item_id:  item.id,
    document_id:    documentId,
    etag:           item.eTag ?? null,
    item_path:      item.parentReference?.path ?? null,
    item_name:      item.name ?? null,
    size_bytes:     bytes.length,
    last_synced_at: new Date().toISOString(),
  }, { onConflict: 'connection_id,graph_item_id' })

  await triggerTraining(ctx.baseUrl, documentId!)

  return existing?.document_id ? { kind: 'updated' } : { kind: 'imported', bytes: bytes.length }
}

/**
 * A file deleted in SharePoint stops being answerable here.
 *
 * Deliberately a real deletion rather than a flag. A document that no
 * longer exists at source but still answers questions is the worst kind
 * of stale: confidently cited, and wrong in a way nobody can see.
 */
async function removeItem(
  service: SupabaseClient,
  connectionId: string,
  graphItemId: string,
): Promise<number> {
  const { data: mapping } = await service
    .from('sharepoint_items')
    .select('id, document_id')
    .eq('connection_id', connectionId)
    .eq('graph_item_id', graphItemId)
    .maybeSingle()

  if (!mapping) return 0

  if (mapping.document_id) {
    const { data: doc } = await service
      .from('documents').select('file_path').eq('id', mapping.document_id).maybeSingle()

    await service.from('document_chunks').delete().eq('document_id', mapping.document_id)
    await service.from('documents').delete().eq('id', mapping.document_id)
    if (doc?.file_path) {
      await service.storage.from('documents').remove([doc.file_path]).catch(() => {})
    }
  }

  await service.from('sharepoint_items').delete().eq('id', mapping.id)
  return 1
}

/* ── bookkeeping ──────────────────────────────────────────────────── */

async function currentUsage(service: SupabaseClient, tenantId: string) {
  const { count } = await service
    .from('documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId)
  const { data: sizes } = await service
    .from('documents').select('file_size').eq('tenant_id', tenantId)
  const bytes = (sizes ?? []).reduce((a, r) => a + Number(r.file_size ?? 0), 0)
  return { documents: count ?? 0, bytes }
}

async function recordRun(
  service: SupabaseClient,
  connectionId: string,
  link: string | null,
  result: SyncResult,
): Promise<void> {
  await service.from('sharepoint_connections').update({
    delta_link:       link,
    last_sync_at:     new Date().toISOString(),
    last_sync_status: result.status,
    last_sync_detail: result.detail.slice(0, 500),
    updated_at:       new Date().toISOString(),
  }).eq('id', connectionId)
}

/** Every enabled connection, oldest sync first so none is starved. */
export async function dueConnections(limit = 5): Promise<SharePointConnection[]> {
  const { data } = await svc()
    .from('sharepoint_connections')
    .select('*')
    .eq('enabled', true)
    .order('last_sync_at', { ascending: true, nullsFirst: true })
    .limit(limit)
  return (data ?? []) as SharePointConnection[]
}
