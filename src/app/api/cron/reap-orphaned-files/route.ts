import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { mustRows } from '@/lib/dbResult'

/**
 * Deletes stored files that no document row points at any more.
 *
 * Two things leave files behind. A document deleted while the storage
 * removal fails — logged, but the file stays. And, more commonly, an
 * upload that never completed: the signed URL is issued and the file
 * transferred before the row is created, so an abandoned upload, a closed
 * tab or a failed finalize leaves the file with nothing referring to it.
 * Either way the customer's content sits in the bucket, unreachable
 * through the product and invisible in it, which is not what the data
 * protection documentation tells them happens when they delete something.
 *
 * THE SAFETY RULE THIS ROUTE IS BUILT AROUND. It decides what to delete by
 * comparing storage against the set of referenced paths — so if the query
 * for those paths fails and returns an empty set, EVERY file in the bucket
 * looks orphaned and the sweep deletes all of it. That is the single way
 * this route could destroy a customer's documents, and it is exactly the
 * failure mode that returns `{ data: null, error }` rather than throwing.
 * The read therefore uses mustRows, which throws; the sweep aborts; and
 * nothing is deleted on a failed read. Every other guard here is
 * secondary to that one.
 *
 * Also bounded by: a grace period well longer than any upload could take,
 * a cap on deletions per run, and a dry-run mode that reports without
 * acting.
 */

export const maxDuration = 300

// Longer than any upload-then-finalize could plausibly take. A 500MB file
// on a slow connection plus a 300s finalize is minutes; a day is not
// close. Nothing newer than this is touched, whatever the comparison says.
const GRACE_HOURS = 24

// Blast-radius cap. A sweep that wants to delete more than this has
// probably misunderstood something, so it stops and says so instead.
const MAX_DELETIONS_PER_RUN = 500

const BUCKET = 'documents'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

interface StorageEntry {
  path: string
  createdAt: number
  bytes: number
}

/** Every object in the bucket, walking the per-tenant folders. */
async function listAllObjects(service: ReturnType<typeof svc>): Promise<StorageEntry[]> {
  const entries: StorageEntry[] = []
  const { data: folders, error: rootError } = await service.storage.from(BUCKET).list('', { limit: 1000 })
  if (rootError) throw new Error(`could not list the bucket: ${rootError.message}`)

  for (const folder of folders ?? []) {
    // A folder entry has no id; a file at the root does.
    if (folder.id) {
      entries.push({
        path: folder.name,
        createdAt: Date.parse(folder.created_at ?? '') || 0,
        bytes: (folder.metadata as { size?: number } | null)?.size ?? 0,
      })
      continue
    }
    for (let offset = 0; ; offset += 1000) {
      const { data: files, error } = await service.storage
        .from(BUCKET)
        .list(folder.name, { limit: 1000, offset })
      if (error) throw new Error(`could not list ${folder.name}: ${error.message}`)
      for (const file of files ?? []) {
        if (!file.id) continue
        entries.push({
          path: `${folder.name}/${file.name}`,
          createdAt: Date.parse(file.created_at ?? '') || 0,
          bytes: (file.metadata as { size?: number } | null)?.size ?? 0,
        })
      }
      if (!files || files.length < 1000) break
    }
  }
  return entries
}

export async function GET(request: NextRequest) {
  // Same contract as the other cron route: Vercel sets this header for
  // cron invocations when CRON_SECRET is set. Without a secret configured,
  // refuse rather than run unauthenticated — this route deletes files
  // across every workspace.
  const bearer = request.headers.get('authorization')
  const internal = request.headers.get('x-cron-secret')
  const secret = process.env.CRON_SECRET
  if (!secret || (bearer !== `Bearer ${secret}` && internal !== secret)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1'
  const service = svc()

  try {
    // The referenced set, read so that a failure throws. See the safety
    // rule above: an empty set from a failed read would condemn the whole
    // bucket.
    const referenced = new Set<string>()
    for (let from = 0; ; from += 1000) {
      const rows = mustRows<{ file_path: string | null }>(
        await service.from('documents').select('file_path').range(from, from + 999),
        'the file paths documents refer to',
      )
      for (const row of rows) if (row.file_path) referenced.add(row.file_path)
      if (rows.length < 1000) break
    }

    // Transcriptions are keyed by document, not by path, so nothing else
    // in the schema refers to a storage path. If that changes, its paths
    // have to be added here before this route can be trusted again.
    if (referenced.size === 0) {
      const { count } = await service.from('documents').select('*', { count: 'exact', head: true })
      if ((count ?? 0) > 0) {
        return NextResponse.json({
          error: 'Refusing to sweep: documents exist but none reported a file path, which would make every stored file look orphaned.',
        }, { status: 500 })
      }
    }

    const objects = await listAllObjects(service)
    const cutoff = Date.now() - GRACE_HOURS * 3600_000

    const orphans = objects.filter(o => !referenced.has(o.path) && o.createdAt > 0 && o.createdAt < cutoff)
    const tooNew = objects.filter(o => !referenced.has(o.path) && (o.createdAt === 0 || o.createdAt >= cutoff))
    const bytes = orphans.reduce((total, o) => total + o.bytes, 0)

    if (orphans.length > MAX_DELETIONS_PER_RUN) {
      console.error(
        `[reap] ${orphans.length} orphaned file(s) found, which exceeds the ${MAX_DELETIONS_PER_RUN} ` +
        `this run will delete. Not deleting anything — investigate before raising the cap.`,
      )
      return NextResponse.json({
        checked: objects.length, referenced: referenced.size,
        orphans: orphans.length, deleted: 0,
        error: `Found ${orphans.length} orphaned files, above the ${MAX_DELETIONS_PER_RUN} per-run cap. Nothing was deleted.`,
      }, { status: 409 })
    }

    let deleted = 0
    if (!dryRun && orphans.length) {
      for (let i = 0; i < orphans.length; i += 100) {
        const batch = orphans.slice(i, i + 100).map(o => o.path)
        const { error } = await service.storage.from(BUCKET).remove(batch)
        if (error) {
          console.error(`[reap] could not remove a batch of ${batch.length}: ${error.message}`)
          continue
        }
        deleted += batch.length
      }
    }

    // Named in the log, not just counted: an orphan is a customer's file,
    // and whoever reads this later may need to know which.
    for (const orphan of orphans.slice(0, 50)) {
      console.log(`[reap] ${dryRun ? 'would delete' : 'deleted'} ${orphan.path} (${orphan.bytes} bytes)`)
    }

    return NextResponse.json({
      dryRun,
      checked: objects.length,
      referenced: referenced.size,
      orphans: orphans.length,
      withinGracePeriod: tooNew.length,
      deleted,
      bytesReclaimed: dryRun ? 0 : bytes,
    })
  } catch (e) {
    // Includes the deliberate throw from mustRows. Nothing has been
    // deleted by the time anything here can fail.
    console.error('[reap] sweep aborted without deleting anything:', (e as Error).message)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
