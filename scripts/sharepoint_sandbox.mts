/**
 * A SharePoint you can run on your laptop.
 *
 * The connector talks to Microsoft Graph. Graph needs an Azure
 * application, an administrator's consent and a real Microsoft 365
 * tenant, none of which exist while the feature is being built — and even
 * once they do, arranging for a file to be deleted, a cursor to expire or
 * the service to start throttling, on demand, in a real tenant, is
 * somewhere between awkward and impossible.
 *
 * So this serves the handful of Graph endpoints the connector uses, from
 * a folder on disk. A file in the folder is a file in the library. Add
 * one and the next sync imports it; edit one and the next sync updates
 * it; delete one and the next sync removes the document. That is the
 * whole mental model, and it is the real one — the connector cannot tell
 * the difference, because nothing in it knows this exists.
 *
 *   npx tsx scripts/sharepoint_sandbox.mts [--port 4000] [--dir <folder>]
 *
 * Then point the connector at it:
 *
 *   MS_LOGIN_BASE_URL=http://localhost:4000
 *   MS_GRAPH_BASE_URL=http://localhost:4000/v1.0
 *   MS_GRAPH_CLIENT_ID=sandbox
 *   MS_GRAPH_CLIENT_SECRET=sandbox
 *
 * Faults are triggered deliberately rather than waited for:
 *
 *   curl -X POST localhost:4000/_control/throttle-next
 *   curl -X POST localhost:4000/_control/expire-cursors
 *   curl -X POST localhost:4000/_control/state
 *
 * It is a stand-in, not an emulator. It implements what the connector
 * asks for and nothing else, and it is deliberately strict where Graph is
 * strict — a cursor it did not issue is rejected, not tolerated — so that
 * code which passes here is not relying on this being lenient.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const args = process.argv.slice(2)
const flag = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}

const PORT = Number(flag('port', '4000'))
const LIBRARY_DIR = path.resolve(flag('dir', path.join(process.cwd(), 'sandbox', 'library')))
const SITE_ID = 'sandbox-site'
const DRIVE_ID = 'sandbox-drive'

fs.mkdirSync(LIBRARY_DIR, { recursive: true })

/* ── the library, read from disk ──────────────────────────────────── */

interface Item {
  id: string
  name: string
  size: number
  mtimeMs: number
  etag: string
  mimeType: string
  relPath: string
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
}

/**
 * An id that survives edits but not renames — same as SharePoint, where
 * the id is the file's identity and the name is an attribute of it.
 */
const idFor = (rel: string) => 'spitem-' + crypto.createHash('sha1').update(rel).digest('hex').slice(0, 16)

function readLibrary(dir = LIBRARY_DIR, base = ''): Item[] {
  const out: Item[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
    const abs = path.join(dir, entry.name)
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) { out.push(...readLibrary(abs, rel)); continue }
    const st = fs.statSync(abs)
    out.push({
      id: idFor(rel),
      name: entry.name,
      size: st.size,
      mtimeMs: st.mtimeMs,
      // Changes whenever the bytes do, which is exactly what an eTag is
      // for and what lets the connector skip unchanged files.
      etag: crypto.createHash('sha1').update(`${st.size}:${Math.round(st.mtimeMs)}`).digest('hex').slice(0, 20),
      mimeType: MIME[path.extname(entry.name).toLowerCase()] ?? 'application/octet-stream',
      relPath: rel,
    })
  }
  return out
}

/* ── cursors ──────────────────────────────────────────────────────── */

/**
 * A cursor records what the library looked like when it was issued, so
 * the next call can report the difference — including deletions, which
 * cannot be derived from the current folder alone.
 */
interface Cursor { issuedAt: number; snapshot: Map<string, string> }
const cursors = new Map<string, Cursor>()
let expireNextCursorUse = false
let throttleNextRequest = false
let requestCount = 0

function issueCursor(items: Item[]): string {
  const token = 'delta-' + crypto.randomBytes(9).toString('hex')
  cursors.set(token, { issuedAt: Date.now(), snapshot: new Map(items.map(i => [i.id, i.etag])) })
  return token
}

/* ── responses ────────────────────────────────────────────────────── */

const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(payload)
}

const graphError = (res: http.ServerResponse, status: number, code: string, message: string, headers = {}) =>
  json(res, status, { error: { code, message } }, headers)

function driveItemJson(item: Item, base: string) {
  return {
    id: item.id,
    name: item.name,
    eTag: item.etag,
    size: item.size,
    file: { mimeType: item.mimeType },
    lastModifiedDateTime: new Date(item.mtimeMs).toISOString(),
    webUrl: `${base}/sandbox/${encodeURIComponent(item.relPath)}`,
    parentReference: { driveId: DRIVE_ID, path: `/drive/root:/${path.dirname(item.relPath)}` },
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const p = url.pathname
  const base = `http://localhost:${PORT}`
  requestCount++

  /* ── control surface, for tests ── */
  if (p.startsWith('/_control/')) {
    const action = p.slice('/_control/'.length)
    if (action === 'throttle-next') { throttleNextRequest = true; return json(res, 200, { ok: true, throttleNextRequest }) }
    if (action === 'expire-cursors') { expireNextCursorUse = true; return json(res, 200, { ok: true, expireNextCursorUse }) }
    if (action === 'state') {
      const items = readLibrary()
      return json(res, 200, {
        libraryDir: LIBRARY_DIR,
        fileCount: items.length,
        files: items.map(i => ({ id: i.id, name: i.name, size: i.size, etag: i.etag })),
        cursorsIssued: cursors.size,
        requestCount,
      })
    }
    return json(res, 404, { error: 'unknown control action' })
  }

  // Throttling, on demand. The connector is supposed to wait and retry;
  // one second keeps the test fast while exercising the real path.
  if (throttleNextRequest && !p.endsWith('/token')) {
    throttleNextRequest = false
    return graphError(res, 429, 'activityLimitReached',
      'Sandbox: throttling this request on purpose.', { 'Retry-After': '1' })
  }

  /* ── token ── */
  if (p.endsWith('/oauth2/v2.0/token')) {
    return json(res, 200, {
      token_type: 'Bearer',
      expires_in: 3600,
      access_token: 'sandbox-token-' + crypto.randomBytes(6).toString('hex'),
    })
  }

  // Everything below is Graph proper and needs the bearer token, because
  // forgetting to send it should fail here rather than in production.
  if (!(req.headers.authorization ?? '').startsWith('Bearer ')) {
    return graphError(res, 401, 'InvalidAuthenticationToken', 'Sandbox: missing bearer token.')
  }

  /* ── sites and drives ── */
  if (p.endsWith('/sites') || p.endsWith('/sites/')) {
    return json(res, 200, {
      value: [{ id: SITE_ID, name: 'Sandbox', displayName: 'Sandbox Site', webUrl: `${base}/sandbox` }],
    })
  }
  if (/\/sites\/[^/]+\/drives$/.test(p)) {
    return json(res, 200, {
      value: [{ id: DRIVE_ID, name: 'Documents', driveType: 'documentLibrary', webUrl: `${base}/sandbox` }],
    })
  }
  if (/\/sites\/[^/]+$/.test(p)) {
    return json(res, 200, { id: SITE_ID, displayName: 'Sandbox Site', webUrl: `${base}/sandbox` })
  }

  /* ── file bytes ── */
  const contentMatch = /\/drives\/([^/]+)\/items\/([^/]+)\/content$/.exec(p)
  if (contentMatch) {
    const item = readLibrary().find(i => i.id === decodeURIComponent(contentMatch[2]))
    if (!item) return graphError(res, 404, 'itemNotFound', 'Sandbox: no such item.')
    const bytes = fs.readFileSync(path.join(LIBRARY_DIR, item.relPath))
    res.writeHead(200, { 'Content-Type': item.mimeType, 'Content-Length': String(bytes.length) })
    return res.end(bytes)
  }

  /* ── the change feed ── */
  if (/\/drives\/([^/]+)\/root\/delta$/.test(p)) {
    const items = readLibrary()
    const token = url.searchParams.get('token')

    if (!token) {
      // A full read of the library.
      return json(res, 200, {
        value: items.map(i => driveItemJson(i, base)),
        '@odata.deltaLink': `${base}/v1.0/drives/${DRIVE_ID}/root/delta?token=${issueCursor(items)}`,
      })
    }

    if (expireNextCursorUse) {
      expireNextCursorUse = false
      // Graph's way of saying "your cursor is too old, start again". The
      // Location header carries where to start, and the connector is
      // expected to follow it rather than give up.
      return graphError(res, 410, 'resyncRequired', 'Sandbox: this cursor has expired on purpose.', {
        Location: `${base}/v1.0/drives/${DRIVE_ID}/root/delta`,
      })
    }

    const cursor = cursors.get(token)
    if (!cursor) {
      return graphError(res, 410, 'resyncRequired', 'Sandbox: unknown cursor.', {
        Location: `${base}/v1.0/drives/${DRIVE_ID}/root/delta`,
      })
    }

    const changed = items.filter(i => cursor.snapshot.get(i.id) !== i.etag)
    const presentIds = new Set(items.map(i => i.id))
    const removed = [...cursor.snapshot.keys()].filter(id => !presentIds.has(id))

    return json(res, 200, {
      value: [
        ...changed.map(i => driveItemJson(i, base)),
        ...removed.map(id => ({ id, deleted: { state: 'deleted' } })),
      ],
      '@odata.deltaLink': `${base}/v1.0/drives/${DRIVE_ID}/root/delta?token=${issueCursor(items)}`,
    })
  }

  return graphError(res, 404, 'unknownEndpoint', `Sandbox does not implement ${p}`)
})

server.listen(PORT, () => {
  const items = readLibrary()
  console.log(`SharePoint sandbox on http://localhost:${PORT}`)
  console.log(`  library folder : ${LIBRARY_DIR}`)
  console.log(`  files right now: ${items.length}${items.length ? ' — ' + items.map(i => i.name).join(', ') : ' (drop some in)'}`)
  console.log(`  site ${SITE_ID} / drive ${DRIVE_ID}`)
  console.log('')
  console.log('Point the connector at it with:')
  console.log(`  MS_LOGIN_BASE_URL=http://localhost:${PORT}`)
  console.log(`  MS_GRAPH_BASE_URL=http://localhost:${PORT}/v1.0`)
  console.log('  MS_GRAPH_CLIENT_ID=sandbox  MS_GRAPH_CLIENT_SECRET=sandbox')
})
