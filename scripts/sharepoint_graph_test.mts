/**
 * Exercises the Graph client against the sandbox. No database involved.
 *
 * Everything genuinely difficult about talking to SharePoint lives in
 * src/lib/sharepoint/graph.ts — tokens, the change feed, paging cursors,
 * deletions, throttling, expired cursors — and none of it needs a
 * workspace to test. This checks that layer on its own, so a failure here
 * means the Graph conversation is wrong, rather than something further
 * downstream.
 *
 *   npx tsx scripts/sharepoint_graph_test.mts
 *
 * Starts its own sandbox on a scratch folder and cleans up after itself.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'

const PORT = 4322
const LIB = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-graph-'))

process.env.MS_LOGIN_BASE_URL = `http://localhost:${PORT}`
process.env.MS_GRAPH_BASE_URL = `http://localhost:${PORT}/v1.0`
process.env.MS_GRAPH_CLIENT_ID = 'sandbox'
process.env.MS_GRAPH_CLIENT_SECRET = 'sandbox'

const {
  getAccessToken, listSites, listDrives, getDeltaPage, downloadItem,
  isImportableFile, clearTokenCache, GraphError, isGraphConfigured,
} = await import('../src/lib/sharepoint/graph')

const creds = { azureTenantId: 'sandbox-tenant' }
const DRIVE = 'sandbox-drive'

const failures: string[] = []
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failures.push(label)
}
const write = (name: string, body: string) => fs.writeFileSync(path.join(LIB, name), body, 'utf8')
const control = (a: string) => fetch(`http://localhost:${PORT}/_control/${a}`, { method: 'POST' }).then(r => r.json())

let sandbox: ChildProcess | null = null

async function main() {
  write('alpha.txt', 'Alpha. The first document.')
  write('beta.txt', 'Beta. The second document.')
  write('gamma.txt', 'Gamma. The third document.')

  sandbox = spawn('npx', ['tsx', 'scripts/sharepoint_sandbox.mts', '--port', String(PORT), '--dir', LIB],
    { stdio: 'ignore', shell: true })
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500))
    try { await control('state'); break } catch { /* starting */ }
  }

  ok(isGraphConfigured(), 'client reports itself configured')

  const token = await getAccessToken(creds)
  ok(token.startsWith('sandbox-token-'), 'obtained an app-only token')
  const again = await getAccessToken(creds)
  ok(again === token, 'token is cached rather than re-requested per call')

  const sites = await listSites(creds)
  ok(sites.length === 1 && sites[0].id === 'sandbox-site', `found the site (${sites.length})`)
  const drives = await listDrives(creds, 'sandbox-site')
  ok(drives.length === 1 && drives[0].id === DRIVE, `found the document library (${drives.length})`)

  // ── a first read of the library ──
  console.log('')
  console.log('── reading the library for the first time ──')
  let page = await getDeltaPage(creds, DRIVE)
  const files = page.items.filter(isImportableFile)
  ok(files.length === 3, `3 files (${files.length})`)
  ok(!!page.deltaLink, 'received a cursor for next time')
  let cursor = page.deltaLink!

  const first = files.find(f => f.name === 'alpha.txt')!
  const { bytes, contentType } = await downloadItem(creds, DRIVE, first.id)
  ok(bytes.toString('utf8').startsWith('Alpha.'), 'downloaded the right bytes')
  ok(contentType === 'text/plain', `content type preserved (${contentType})`)

  // ── nothing has changed ──
  console.log('')
  console.log('── nothing has changed ──')
  page = await getDeltaPage(creds, DRIVE, cursor)
  ok(page.items.length === 0, `no changes reported (${page.items.length})`)
  cursor = page.deltaLink!

  // ── one file is edited ──
  console.log('')
  console.log('── one file is edited ──')
  await new Promise(r => setTimeout(r, 1100))
  write('beta.txt', 'Beta, revised. The second document, rewritten.')
  page = await getDeltaPage(creds, DRIVE, cursor)
  ok(page.items.length === 1 && page.items[0].name === 'beta.txt',
     `exactly the edited file (${page.items.map(i => i.name).join(', ') || 'none'})`)
  cursor = page.deltaLink!

  // ── one file is deleted ──
  console.log('')
  console.log('── one file is deleted ──')
  fs.unlinkSync(path.join(LIB, 'gamma.txt'))
  page = await getDeltaPage(creds, DRIVE, cursor)
  const deletions = page.items.filter(i => i.deleted)
  ok(deletions.length === 1, `one deletion reported (${deletions.length})`)
  ok(!isImportableFile(deletions[0]), 'a deletion is not treated as a file to import')
  cursor = page.deltaLink!

  // ── the service throttles us ──
  console.log('')
  console.log('── the service throttles us ──')
  await control('throttle-next')
  const t0 = Date.now()
  page = await getDeltaPage(creds, DRIVE, cursor)
  const waited = Date.now() - t0
  ok(waited >= 900, `waited for Retry-After rather than failing (${waited}ms)`)
  cursor = page.deltaLink!

  // ── the cursor expires ──
  console.log('')
  console.log('── the cursor expires ──')
  await control('expire-cursors')
  let resync = false
  try {
    await getDeltaPage(creds, DRIVE, cursor)
  } catch (e) {
    resync = e instanceof GraphError && e.resyncRequired
  }
  ok(resync, 'an expired cursor raises resyncRequired, not a generic failure')

  const fresh = await getDeltaPage(creds, DRIVE)
  ok(fresh.items.filter(isImportableFile).length === 2,
     `re-reading the library finds the 2 remaining files (${fresh.items.filter(isImportableFile).length})`)

  // ── an unknown tenant ──
  console.log('')
  console.log('── misconfiguration ──')
  clearTokenCache()
  delete process.env.MS_GRAPH_CLIENT_SECRET
  let configErr = false
  try { await getAccessToken({ azureTenantId: 'x' }) } catch (e) { configErr = (e as Error).name === 'GraphNotConfiguredError' }
  ok(configErr, 'missing credentials raise a named error, not a crash')
}

main()
  .catch(e => { console.error(''); console.error('ERROR:', (e as Error).message); failures.push('threw: ' + (e as Error).message) })
  .finally(() => {
    sandbox?.kill()
    fs.rmSync(LIB, { recursive: true, force: true })
    console.log('')
    console.log(failures.length ? `FAILED (${failures.length}): ${failures.join('; ')}` : 'ALL CHECKS PASSED')
    process.exit(failures.length ? 1 : 0)
  })
