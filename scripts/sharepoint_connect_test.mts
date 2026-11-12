/**
 * Drives the connect screen's API the way the browser does.
 *
 * scripts/sharepoint_sync_test.mts proves the sync engine works. This
 * proves the screen on top of it works: that a Senior can discover a
 * site, connect a library, sync it, change its sensitivity, and
 * disconnect — over real HTTP, with a real signed-in session, against the
 * running dev server.
 *
 * Why a forged cookie rather than a browser: the session cookie
 * @supabase/ssr sets is just the session object, base64 in a named
 * cookie. Building it here signs in exactly as the browser does without
 * needing one, so this can run in CI.
 *
 * The cases it covers are the ones a unit test cannot reach:
 *
 *   - an anonymous caller is refused by every route
 *   - a Junior is refused, with a reason naming the restriction
 *   - a Senior can discover, connect and sync
 *   - connecting the same library twice is refused, not duplicated
 *   - raising the sensitivity relabels the documents ALREADY imported,
 *     not only the ones imported next
 *   - disconnecting keeps the documents by default
 *   - disconnecting with removeDocuments=1 removes them
 *
 * Needs the sandbox and the dev server running, the dev server started
 * with the sandbox's MS_* variables and SHAREPOINT_SKIP_TRAINING=1:
 *
 *   npx tsx scripts/sharepoint_sandbox.mts --port 4000 --dir sandbox/library
 *   MS_LOGIN_BASE_URL=http://localhost:4000 \
 *   MS_GRAPH_BASE_URL=http://localhost:4000/v1.0 \
 *   MS_GRAPH_CLIENT_ID=sandbox MS_GRAPH_CLIENT_SECRET=sandbox \
 *   SHAREPOINT_SKIP_TRAINING=1 npm run dev
 *
 *   npx tsx scripts/sharepoint_connect_test.mts
 *
 * It creates a scratch workspace and two scratch sign-ins, uses them, and
 * deletes everything it made on the way out, including on failure.
 */
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

process.loadEnvFile(path.join(process.cwd(), '.env.local'))

const APP = process.env.CONNECT_TEST_APP_URL ?? 'http://localhost:3000'
const SANDBOX = 'http://localhost:4000'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const db = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const failures: string[] = []
const skipped: string[] = []
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failures.push(label)
}
/**
 * A case that cannot run here, said out loud rather than quietly passing.
 *
 * Only used for the cases that depend on the platform's AI document
 * processing switch. Importing is what that switch governs, so with it off
 * there is nothing to measure — and turning it on from a test would
 * un-pause every workspace on the platform, which is not a test's
 * decision to make. The engine underneath is covered without it by
 * scripts/sharepoint_sync_test.mts.
 */
const skip = (label: string, why: string) => {
  console.log(`SKIP  ${label} — ${why}`)
  skipped.push(label)
}

/** The project ref, which is what names the session cookie. */
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`

let tenantId: string | null = null
let connectionId: string | null = null
const scratchUsers: string[] = []

interface Actor { cookie: string; userId: string; email: string }

/**
 * Sign in and build the cookie the browser would be holding.
 *
 * @supabase/ssr writes the session as `base64-` + base64 of the session
 * JSON. Chunking only kicks in above ~3 KB, which a session this size is
 * nowhere near.
 */
async function signIn(email: string, password: string): Promise<Actor> {
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`could not sign in as ${email}: ${error?.message}`)

  const encoded = Buffer.from(JSON.stringify(data.session), 'utf8').toString('base64')
  return {
    cookie: `${COOKIE_NAME}=base64-${encoded}`,
    userId: data.user!.id,
    email,
  }
}

async function call(
  method: string,
  routePath: string,
  { actor, body }: { actor?: Actor; body?: unknown } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${APP}${routePath}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(actor ? { cookie: actor.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({})) as Record<string, unknown>
  return { status: res.status, json }
}

async function makeActor(role: string, label: string): Promise<Actor> {
  const email = `sp-connect-${label}-${Math.random().toString(36).slice(2, 8)}@example.invalid`
  const password = `Sp!${Math.random().toString(36).slice(2, 14)}`

  const { data: created, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name: `SharePoint test ${label}` },
  })
  if (error || !created.user) throw new Error(`could not create the ${label} sign-in: ${error?.message}`)
  scratchUsers.push(created.user.id)

  // The app's own users table, which memberships point at.
  await db.from('users').upsert({ id: created.user.id, email, name: `SharePoint test ${label}` })
  const { error: mErr } = await db.from('memberships').insert({
    tenant_id: tenantId, user_id: created.user.id, role,
  })
  if (mErr) throw new Error(`could not make the ${label} a ${role}: ${mErr.message}`)

  return await signIn(email, password)
}

/**
 * The rows the importer would have written, written by hand.
 *
 * Used only when the platform's AI document processing switch is off, so
 * that the two paths that DESTROY things — relabelling documents already
 * imported, and disconnecting with removal — are still exercised rather
 * than skipped. The switch gates importing; it does not gate deleting,
 * and a deletion path that has never run is the last thing to ship.
 *
 * Deliberately no stored file: these documents are never read, and
 * missing storage is a case the removal path has to survive anyway.
 */
async function seedImportedDocuments(
  connection: { id: string; sensitivity: string },
  count: number,
  userId: string,
): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const { data, error } = await db.from('documents').insert({
      tenant_id:   tenantId,
      uploaded_by: userId,
      title:       `Seeded sandbox file ${i + 1}`,
      source:      `seeded-${i + 1}.txt`,
      sensitivity: connection.sensitivity,
      status:      'ready',
      file_size:   64,
      mime_type:   'text/plain',
    }).select('id').single()
    if (error || !data) throw new Error(`could not seed a document: ${error?.message}`)
    ids.push(data.id)
    const { error: mapError } = await db.from('sharepoint_items').insert({
      connection_id: connection.id,
      graph_item_id: `seeded-item-${i + 1}`,
      document_id:   data.id,
      etag:          'seeded',
      item_name:     `seeded-${i + 1}.txt`,
      size_bytes:    64,
    })
    if (mapError) throw new Error(`could not seed the file mapping: ${mapError.message}`)
  }
  return ids
}

async function docsInWorkspace() {
  const { data } = await db.from('documents').select('id, title, sensitivity').eq('tenant_id', tenantId!)
  return data ?? []
}

async function cleanup() {
  try {
    if (connectionId) {
      const { data: items } = await db.from('sharepoint_items').select('document_id').eq('connection_id', connectionId)
      for (const item of items ?? []) {
        if (item.document_id) {
          await db.from('document_chunks').delete().eq('document_id', item.document_id)
          await db.from('documents').delete().eq('id', item.document_id)
        }
      }
      await db.from('sharepoint_connections').delete().eq('id', connectionId)
    }
    if (tenantId) {
      await db.from('sharepoint_connections').delete().eq('tenant_id', tenantId)
      await db.from('audit_logs').delete().eq('tenant_id', tenantId)
      await db.from('documents').delete().eq('tenant_id', tenantId)
      await db.from('memberships').delete().eq('tenant_id', tenantId)
      await db.from('tenants').delete().eq('id', tenantId)
    }
    for (const id of scratchUsers) {
      await db.from('users').delete().eq('id', id)
      await db.auth.admin.deleteUser(id).catch(() => {})
    }
  } catch (e) {
    console.error('cleanup problem:', (e as Error).message)
  }
}

async function main() {
  // ── the server and the sandbox are both up ──
  const state = await fetch(`${SANDBOX}/_control/state`, { method: 'POST' })
    .then(r => r.json() as Promise<{ fileCount: number }>)
    .catch(() => { throw new Error(`the sandbox is not running on ${SANDBOX}`) })
  ok(state.fileCount > 0, `sandbox serving ${state.fileCount} file(s)`)

  // Whether anything can be imported at all. Read rather than changed.
  const { data: trainingSwitch } = await db.from('platform_settings')
    .select('value').eq('key', 'ai_training_enabled').maybeSingle()
  const trainingOn = trainingSwitch?.value !== false
  console.log(`      AI document processing is ${trainingOn ? 'on' : 'OFF — import cases will be skipped'}`)

  // ── nobody is signed in ──
  console.log('')
  console.log('── an anonymous caller ──')
  const anonList = await call('GET', '/api/connections/sharepoint')
  ok(anonList.status === 401, `listing is refused (${anonList.status})`)
  const anonDiscover = await call('POST', '/api/connections/sharepoint/discover',
    { body: { azureTenantId: 'sandbox-tenant' } })
  ok(anonDiscover.status === 401, `discovery is refused (${anonDiscover.status})`)

  // ── a workspace, a Senior and a Junior ──
  const { data: tenant, error: tErr } = await db.from('tenants').insert({
    name: 'SharePoint Connect Test',
    subdomain: 'sp-connect-' + Math.random().toString(36).slice(2, 8),
    plan: 'professional',
  }).select('id').single()
  if (tErr || !tenant) throw new Error(`could not create the test workspace: ${tErr?.message}`)
  tenantId = tenant.id

  const senior = await makeActor('senior', 'senior')
  const junior = await makeActor('junior', 'junior')

  // ── a Junior may not ──
  console.log('')
  console.log('── a Junior member ──')
  const juniorList = await call('GET', '/api/connections/sharepoint', { actor: junior })
  ok(juniorList.status === 403, `listing is refused (${juniorList.status})`)
  ok(typeof juniorList.json.error === 'string' && /Senior/.test(juniorList.json.error as string),
     `and says why: "${juniorList.json.error}"`)

  // ── a Senior discovers the library ──
  console.log('')
  console.log('── a Senior discovers the library ──')
  const seniorList = await call('GET', '/api/connections/sharepoint', { actor: senior })
  ok(seniorList.status === 200, `listing is allowed (${seniorList.status})`)
  ok(seniorList.json.configured === true, 'the deployment reports SharePoint as set up')
  ok(Array.isArray(seniorList.json.connections) && (seniorList.json.connections as unknown[]).length === 0,
     'the workspace starts with no connections')

  const sites = await call('POST', '/api/connections/sharepoint/discover',
    { actor: senior, body: { azureTenantId: 'sandbox-tenant' } })
  const siteList = (sites.json.sites ?? []) as { id: string; name: string }[]
  ok(sites.status === 200 && siteList.length === 1, `found 1 site (${siteList.length})`)

  const drives = await call('POST', '/api/connections/sharepoint/discover',
    { actor: senior, body: { azureTenantId: 'sandbox-tenant', siteId: 'sandbox-site' } })
  const driveList = (drives.json.drives ?? []) as { id: string; name: string }[]
  ok(drives.status === 200 && driveList.length === 1, `found 1 document library (${driveList.length})`)

  // ── bad input is named, not swallowed ──
  console.log('')
  console.log('── bad input ──')
  const noName = await call('POST', '/api/connections/sharepoint', {
    actor: senior,
    body: { azureTenantId: 'sandbox-tenant', siteId: 'sandbox-site', driveId: 'sandbox-drive', displayName: '' },
  })
  ok(noName.status === 400 && /name/i.test(String(noName.json.error)),
     `a missing name is named: "${noName.json.error}"`)

  const badLevel = await call('POST', '/api/connections/sharepoint', {
    actor: senior,
    body: {
      azureTenantId: 'sandbox-tenant', siteId: 'sandbox-site', driveId: 'sandbox-drive',
      displayName: 'Sandbox', sensitivity: 'top-secret',
    },
  })
  ok(badLevel.status === 400 && /sensitivity level/i.test(String(badLevel.json.error)),
     `an invented sensitivity is refused: "${badLevel.json.error}"`)

  // ── connecting it ──
  console.log('')
  console.log('── connecting the library ──')
  const connected = await call('POST', '/api/connections/sharepoint', {
    actor: senior,
    body: {
      azureTenantId: 'sandbox-tenant', siteId: 'sandbox-site', driveId: 'sandbox-drive',
      displayName: 'Sandbox Library', sensitivity: 'internal',
    },
  })
  ok(connected.status === 200, `connected (${connected.status}) ${connected.json.error ?? ''}`)
  const connection = connected.json.connection as { id: string; sensitivity: string } | undefined
  if (!connection) throw new Error('no connection came back; nothing further can be tested')
  connectionId = connection.id
  ok(connection.sensitivity === 'internal', `stored at the chosen level (${connection.sensitivity})`)

  const twice = await call('POST', '/api/connections/sharepoint', {
    actor: senior,
    body: {
      azureTenantId: 'sandbox-tenant', siteId: 'sandbox-site', driveId: 'sandbox-drive',
      displayName: 'Sandbox Library again', sensitivity: 'internal',
    },
  })
  ok(twice.status === 409, `connecting the same library twice is refused (${twice.status})`)

  // ── syncing it ──
  console.log('')
  console.log('── syncing from the screen ──')
  let importedCount = 0

  if (!trainingOn) {
    // The refusal is itself worth checking: a sync that quietly imported
    // documents nothing can read would be the worse outcome.
    const refused = await call('POST', `/api/connections/sharepoint/${connectionId}/sync`, { actor: senior })
    ok(refused.status === 503 && refused.json.trainingOff === true,
       `with processing off, the sync refuses and says so (${refused.status}): "${refused.json.error}"`)
    ok((await docsInWorkspace()).length === 0, 'and imports nothing rather than queueing unreadable documents')
    skip('importing from the screen', 'AI document processing is switched off')

    // Stand in for the importer, so the relabel and removal paths below
    // still run. Those two change and delete things, and skipping them
    // would leave the only destructive code here untested.
    await seedImportedDocuments(connection, state.fileCount, senior.userId)
    importedCount = state.fileCount
    console.log(`      seeded ${importedCount} document(s) by hand so the relabel and removal paths still run`)
  } else {
    const synced = await call('POST', `/api/connections/sharepoint/${connectionId}/sync`, { actor: senior })
    const result = synced.json.result as { status: string; imported: number; detail: string } | undefined
    ok(synced.status === 200, `the sync ran (${synced.status}) ${synced.json.error ?? ''}`)
    ok(!!result && result.imported === state.fileCount,
       `imported ${state.fileCount} (${result?.imported}) — ${result?.detail}`)

    const imported = await docsInWorkspace()
    ok(imported.length === state.fileCount, `the workspace holds ${state.fileCount} document(s) (${imported.length})`)
    ok(imported.every(d => d.sensitivity === 'internal'),
       'every imported document carries the connection\'s level')
  }

  // ── raising the level reaches what is already here ──
  console.log('')
  console.log('── raising the sensitivity ──')
  const raised = await call('PATCH', `/api/connections/sharepoint/${connectionId}`,
    { actor: senior, body: { sensitivity: 'confidential' } })
  ok(raised.status === 200, `the change was saved (${raised.status}) ${raised.json.error ?? ''}`)
  if (importedCount > 0) {
    ok(raised.json.relabelled === importedCount,
       `${importedCount} already-imported document(s) were relabelled (${raised.json.relabelled})`)
    const afterRaise = await docsInWorkspace()
    ok(afterRaise.every(d => d.sensitivity === 'confidential'),
       'no document was left readable at the old level')
  } else {
    skip('relabelling documents already imported', 'nothing could be imported to relabel')
  }

  const nothingToDo = await call('PATCH', `/api/connections/sharepoint/${connectionId}`,
    { actor: senior, body: { sensitivity: 'confidential' } })
  ok(nothingToDo.status === 400, `an unchanged value is reported, not silently saved (${nothingToDo.status})`)

  // ── pausing ──
  console.log('')
  console.log('── pausing ──')
  const paused = await call('PATCH', `/api/connections/sharepoint/${connectionId}`,
    { actor: senior, body: { enabled: false } })
  ok(paused.status === 200, `paused (${paused.status})`)
  const syncPaused = await call('POST', `/api/connections/sharepoint/${connectionId}/sync`, { actor: senior })
  ok(syncPaused.status === 409, `a paused connection will not sync (${syncPaused.status})`)
  await call('PATCH', `/api/connections/sharepoint/${connectionId}`, { actor: senior, body: { enabled: true } })

  // ── one workspace cannot touch another's connection ──
  console.log('')
  console.log('── another workspace\'s connection ──')
  const asJunior = await call('PATCH', `/api/connections/sharepoint/${connectionId}`,
    { actor: junior, body: { enabled: false } })
  ok(asJunior.status === 403, `a Junior cannot change it either (${asJunior.status})`)

  // ── disconnecting keeps the documents ──
  console.log('')
  console.log('── disconnecting, keeping the documents ──')
  const kept = await call('DELETE', `/api/connections/sharepoint/${connectionId}`, { actor: senior })
  ok(kept.status === 200, `disconnected (${kept.status}) ${kept.json.error ?? ''}`)
  ok(kept.json.documentsRemoved === 0, `nothing was deleted (${kept.json.documentsRemoved})`)
  const afterKeep = await docsInWorkspace()
  if (importedCount > 0) {
    ok(afterKeep.length === importedCount,
       `the ${importedCount} document(s) are still here and still answerable (${afterKeep.length})`)
  } else {
    skip('keeping the documents on disconnect', 'nothing could be imported to keep')
  }

  // Clear them by hand, so the re-connect below starts clean and the last
  // case measures its own deletions rather than these.
  for (const d of afterKeep) {
    await db.from('document_chunks').delete().eq('document_id', d.id)
    await db.from('documents').delete().eq('id', d.id)
  }

  // ── disconnecting and removing them ──
  console.log('')
  console.log('── disconnecting, removing the documents ──')
  const again = await call('POST', '/api/connections/sharepoint', {
    actor: senior,
    body: {
      azureTenantId: 'sandbox-tenant', siteId: 'sandbox-site', driveId: 'sandbox-drive',
      displayName: 'Sandbox Library', sensitivity: 'internal',
    },
  })
  connectionId = (again.json.connection as { id: string } | undefined)?.id ?? null
  ok(!!connectionId, 'the library can be connected again after being disconnected')
  if (!connectionId) return

  if (trainingOn) {
    await call('POST', `/api/connections/sharepoint/${connectionId}/sync`, { actor: senior })
    ok((await docsInWorkspace()).length === state.fileCount, 'and re-imports its files')
  } else {
    skip('reimporting after reconnect', 'AI document processing is switched off')
    await seedImportedDocuments(
      { id: connectionId, sensitivity: 'internal' }, state.fileCount, senior.userId)
  }

  const removed = await call('DELETE', `/api/connections/sharepoint/${connectionId}?removeDocuments=1`,
    { actor: senior })
  ok(removed.status === 200, `disconnected (${removed.status}) ${removed.json.error ?? ''}`)
  if (importedCount > 0) {
    ok(removed.json.documentsRemoved === importedCount,
       `${importedCount} document(s) removed (${removed.json.documentsRemoved})`)
  } else {
    skip('removing the documents on disconnect', 'nothing could be imported to remove')
  }
  ok((await docsInWorkspace()).length === 0, 'the workspace holds no documents from it')
  connectionId = null

  // ── it is all in the audit log ──
  console.log('')
  console.log('── the audit log ──')
  const { data: entries } = await db.from('audit_logs')
    .select('action, metadata').eq('tenant_id', tenantId!).like('action', 'connection.%')
  const actions = (entries ?? []).map(e => e.action)
  ok(actions.filter(a => a === 'connection.added').length === 2, `both connections were recorded (${actions.filter(a => a === 'connection.added').length})`)
  ok(actions.includes('connection.changed'), 'the sensitivity change was recorded')
  ok(actions.filter(a => a === 'connection.removed').length === 2, `both disconnections were recorded (${actions.filter(a => a === 'connection.removed').length})`)
}

main()
  .catch(e => { console.error(''); console.error('ERROR:', (e as Error).message); failures.push('threw: ' + (e as Error).message) })
  .finally(async () => {
    await cleanup()
    console.log('')
    if (skipped.length) {
      console.log(`SKIPPED (${skipped.length}, each needing AI document processing switched on): ${skipped.join('; ')}`)
    }
    console.log(failures.length
      ? `FAILED (${failures.length}): ${failures.join('; ')}`
      : skipped.length
        ? `ALL CHECKS THAT COULD RUN PASSED (${skipped.length} needed the AI switch on)`
        : 'ALL CHECKS PASSED')
    process.exit(failures.length ? 1 : 0)
  })
