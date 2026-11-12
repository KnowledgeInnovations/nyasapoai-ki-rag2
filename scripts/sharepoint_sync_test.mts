/**
 * Drives the SharePoint connector against the sandbox, end to end.
 *
 * It starts a sandbox, creates a connection in a scratch workspace, and
 * then does to the library the things that actually happen to a library —
 * add a file, change one, delete one, leave the rest alone — checking
 * after each that the workspace matches.
 *
 * The cases it covers are the ones that are hard to arrange against a
 * real Microsoft 365 tenant and easy to get wrong:
 *
 *   - a first sync imports everything
 *   - a second sync with nothing changed imports nothing
 *   - a changed file updates its document instead of creating a second
 *   - a deleted file removes the document, so it stops being answerable
 *   - a throttled request is waited out, not failed
 *   - an expired cursor re-reads the library without duplicating anything
 *
 * Training is skipped (SHAREPOINT_SKIP_TRAINING=1): it calls the model
 * providers, costs money, and is not what this is testing.
 *
 *   npx tsx scripts/sharepoint_sync_test.mts
 *
 * It creates a workspace named "SharePoint Sandbox", uses it, and deletes
 * it and everything it made on the way out, including on failure.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

process.loadEnvFile(path.join(process.cwd(), '.env.local'))

const PORT = 4321
const LIB = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-sandbox-'))

process.env.MS_LOGIN_BASE_URL = `http://localhost:${PORT}`
process.env.MS_GRAPH_BASE_URL = `http://localhost:${PORT}/v1.0`
process.env.MS_GRAPH_CLIENT_ID = 'sandbox'
process.env.MS_GRAPH_CLIENT_SECRET = 'sandbox'
process.env.SHAREPOINT_SKIP_TRAINING = '1'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const failures: string[] = []
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failures.push(label)
}

const write = (name: string, body: string) => fs.writeFileSync(path.join(LIB, name), body, 'utf8')
const control = (action: string) =>
  fetch(`http://localhost:${PORT}/_control/${action}`, { method: 'POST' }).then(r => r.json())

let sandbox: ChildProcess | null = null
let tenantId: string | null = null
let connectionId: string | null = null

async function docsInWorkspace() {
  const { data } = await db.from('documents').select('id, title, file_size').eq('tenant_id', tenantId!)
  return data ?? []
}

async function cleanup() {
  try {
    if (connectionId) {
      const { data: items } = await db.from('sharepoint_items').select('document_id').eq('connection_id', connectionId)
      for (const it of items ?? []) {
        if (it.document_id) {
          await db.from('document_chunks').delete().eq('document_id', it.document_id)
          await db.from('documents').delete().eq('id', it.document_id)
        }
      }
      await db.from('sharepoint_items').delete().eq('connection_id', connectionId)
      await db.from('sharepoint_connections').delete().eq('id', connectionId)
    }
    if (tenantId) {
      await db.from('documents').delete().eq('tenant_id', tenantId)
      await db.from('tenants').delete().eq('id', tenantId)
    }
  } catch (e) {
    console.error('cleanup problem:', (e as Error).message)
  }
  sandbox?.kill()
  fs.rmSync(LIB, { recursive: true, force: true })
}

async function main() {
  // ── the library, before anyone syncs it ──
  write('board-minutes.txt', 'Board minutes. The budget for 2026 is GHS 4,200,000.')
  write('staff-handbook.txt', 'Staff handbook. Notice period is three months.')
  write('q1-report.txt', 'Q1 report. Revenue was GHS 1,100,000.')

  sandbox = spawn('npx', ['tsx', 'scripts/sharepoint_sandbox.mts', '--port', String(PORT), '--dir', LIB],
    { stdio: 'ignore', shell: true })

  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500))
    try { await control('state'); break } catch { /* not up yet */ }
  }
  const state = await control('state') as { fileCount: number }
  ok(state.fileCount === 3, `sandbox serving ${state.fileCount} file(s)`)

  // ── a workspace to sync into ──
  const { data: tenant, error: tErr } = await db.from('tenants').insert({
    name: 'SharePoint Sandbox',
    subdomain: 'sp-sandbox-' + Math.random().toString(36).slice(2, 8),
    plan: 'professional',
  }).select('id').single()
  if (tErr || !tenant) throw new Error(`could not create the test workspace: ${tErr?.message}`)
  tenantId = tenant.id

  const { data: someUser } = await db.from('users').select('id').limit(1).maybeSingle()

  const { data: conn, error: cErr } = await db.from('sharepoint_connections').insert({
    tenant_id: tenantId,
    display_name: 'Sandbox Library',
    azure_tenant_id: 'sandbox-tenant',
    site_id: 'sandbox-site',
    drive_id: 'sandbox-drive',
    sensitivity: 'internal',
    connected_by: someUser?.id ?? null,
  }).select('*').single()
  if (cErr || !conn) throw new Error(`could not create the connection: ${cErr?.message}`)
  connectionId = conn.id

  const { syncConnection } = await import('../src/lib/sharepoint/sync')
  const fresh = async () => {
    const { data } = await db.from('sharepoint_connections').select('*').eq('id', connectionId!).single()
    return data as Parameters<typeof syncConnection>[0]
  }
  const run = () => syncConnection as unknown as typeof syncConnection

  // ── 1. first sync imports everything ──
  console.log('')
  console.log('── first sync ──')
  let r = await run()(await fresh(), { baseUrl: 'http://localhost:9999' })
  ok(r.status === 'ok', `status ok (${r.status}) — ${r.detail}`)
  ok(r.imported === 3, `imported 3 (${r.imported})`)
  ok((await docsInWorkspace()).length === 3, 'workspace holds 3 documents')

  // ── 2. nothing changed, nothing re-imported ──
  console.log('')
  console.log('── second sync, nothing changed ──')
  r = await run()(await fresh(), { baseUrl: 'http://localhost:9999' })
  ok(r.imported === 0 && r.updated === 0, `imported 0 / updated 0 (${r.imported}/${r.updated})`)
  ok((await docsInWorkspace()).length === 3, 'still 3 documents — unchanged files were skipped')

  // ── 3. a file changes ──
  console.log('')
  console.log('── a file is edited ──')
  await new Promise(res => setTimeout(res, 1100)) // a distinct mtime
  write('q1-report.txt', 'Q1 report, revised. Revenue was GHS 1,450,000 after the restatement.')
  r = await run()(await fresh(), { baseUrl: 'http://localhost:9999' })
  ok(r.updated === 1 && r.imported === 0, `updated 1, imported 0 (${r.updated}/${r.imported})`)
  ok((await docsInWorkspace()).length === 3, 'still 3 documents — the edit updated, it did not duplicate')

  // ── 4. a file is added ──
  console.log('')
  console.log('── a file is added ──')
  write('policy.txt', 'Travel policy. Economy class for flights under six hours.')
  r = await run()(await fresh(), { baseUrl: 'http://localhost:9999' })
  ok(r.imported === 1, `imported 1 (${r.imported})`)
  ok((await docsInWorkspace()).length === 4, 'workspace holds 4 documents')

  // ── 5. a file is deleted ──
  console.log('')
  console.log('── a file is deleted ──')
  fs.unlinkSync(path.join(LIB, 'staff-handbook.txt'))
  r = await run()(await fresh(), { baseUrl: 'http://localhost:9999' })
  ok(r.deleted === 1, `deleted 1 (${r.deleted})`)
  const after = await docsInWorkspace()
  ok(after.length === 3, 'workspace holds 3 documents')
  ok(!after.some(d => d.title === 'staff-handbook'), 'the deleted file is no longer answerable')

  // ── 6. throttling is waited out ──
  console.log('')
  console.log('── the service throttles us ──')
  await control('throttle-next')
  const t0 = Date.now()
  r = await run()(await fresh(), { baseUrl: 'http://localhost:9999' })
  ok(r.status !== 'failed', `survived a 429 (${r.status})`)
  ok(Date.now() - t0 >= 900, `waited for Retry-After before retrying (${Date.now() - t0}ms)`)

  // ── 7. the cursor expires ──
  console.log('')
  console.log('── the cursor expires ──')
  await control('expire-cursors')
  r = await run()(await fresh(), { baseUrl: 'http://localhost:9999' })
  ok(r.resynced, 're-read the library after 410 Gone')
  ok(r.status !== 'failed', `recovered rather than failing (${r.status})`)
  ok((await docsInWorkspace()).length === 3, 'still 3 documents — a re-read did not duplicate anything')
}

main()
  .catch(e => { console.error(''); console.error('ERROR:', (e as Error).message); failures.push('threw: ' + (e as Error).message) })
  .finally(async () => {
    await cleanup()
    console.log('')
    console.log(failures.length ? `FAILED (${failures.length}): ${failures.join('; ')}` : 'ALL CHECKS PASSED')
    process.exit(failures.length ? 1 : 0)
  })
