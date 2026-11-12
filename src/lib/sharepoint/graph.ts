/**
 * The small part of Microsoft Graph this platform actually uses.
 *
 * Reading a SharePoint library needs four things: a token, a way to find
 * the library, a change feed, and file bytes. That is all that is here.
 * Graph is enormous and almost none of it is relevant.
 *
 * ── Why the base URLs are configurable ───────────────────────────────
 * Nothing in this file hard-codes login.microsoftonline.com or
 * graph.microsoft.com. They default to the real ones and are overridable
 * through the environment, so the whole connector can be exercised against
 * a local stand-in (scripts/sharepoint_sandbox.mts) with no Azure account,
 * no customer tenant and no credentials.
 *
 * That is not a testing convenience bolted on afterwards — it is the only
 * way this could be built at all before someone registers an application,
 * and it means a change to sync logic can be proven against deletions,
 * throttling and expired cursors on demand, which is awkward to arrange
 * against a real tenant and impossible to arrange on a schedule.
 *
 * ── Authentication ───────────────────────────────────────────────────
 * Client credentials, app-only. The platform holds one application
 * registration; each customer's administrator consents to it in their own
 * Microsoft 365 tenant. The token request therefore carries OUR client id
 * and secret but THEIR tenant id, and comes back scoped to their tenant.
 * No customer secret is ever stored. See migration 053.
 */

const LOGIN_BASE = process.env.MS_LOGIN_BASE_URL ?? 'https://login.microsoftonline.com'
const GRAPH_BASE = process.env.MS_GRAPH_BASE_URL ?? 'https://graph.microsoft.com/v1.0'

/** Requests that take longer than this are not going to arrive. */
const REQUEST_TIMEOUT_MS = 60_000

/**
 * How many times to wait out a throttle before giving up.
 *
 * SharePoint allows roughly 1,250 resource units per minute for a tenant
 * under a thousand licences, and a first import of a large library will
 * reach that. Being throttled is the expected path through this code, not
 * an error: the request is retried after the interval the service asks
 * for, and a throttled request still counts against the budget, so
 * retrying faster than asked makes things worse.
 */
const MAX_THROTTLE_RETRIES = 5

/** Graph's own ceiling when it does not say. */
const MAX_RETRY_AFTER_S = 120

export interface GraphCredentials {
  /** The CUSTOMER's Microsoft 365 tenant id. */
  azureTenantId: string
}

export class GraphError extends Error {
  readonly status: number
  readonly code: string | undefined
  /** True when the cursor is too old and the library must be re-read. */
  readonly resyncRequired: boolean
  constructor(status: number, code: string | undefined, message: string) {
    super(message)
    this.name = 'GraphError'
    this.status = status
    this.code = code
    this.resyncRequired = status === 410
  }
}

/** Raised when the platform has no application registration configured. */
export class GraphNotConfiguredError extends Error {
  constructor() {
    super(
      'SharePoint is not configured on this deployment. Set MS_GRAPH_CLIENT_ID and ' +
      'MS_GRAPH_CLIENT_SECRET to the platform\'s Azure application registration.',
    )
    this.name = 'GraphNotConfiguredError'
  }
}

export function isGraphConfigured(): boolean {
  return !!(process.env.MS_GRAPH_CLIENT_ID && process.env.MS_GRAPH_CLIENT_SECRET)
}

/* ── tokens ───────────────────────────────────────────────────────── */

interface CachedToken { token: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>()

/**
 * An app-only access token for one customer tenant.
 *
 * Cached until shortly before it expires. Microsoft issues these for about
 * an hour and rate-limits the token endpoint, so a sync that asked for a
 * fresh token per file would spend most of its budget authenticating.
 */
export async function getAccessToken(creds: GraphCredentials): Promise<string> {
  if (!isGraphConfigured()) throw new GraphNotConfiguredError()

  const cached = tokenCache.get(creds.azureTenantId)
  // Sixty seconds of headroom: a token that expires mid-request is a
  // failure that looks like a permissions problem.
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const body = new URLSearchParams({
    client_id:     process.env.MS_GRAPH_CLIENT_ID!,
    client_secret: process.env.MS_GRAPH_CLIENT_SECRET!,
    scope:         'https://graph.microsoft.com/.default',
    grant_type:    'client_credentials',
  })

  const res = await fetch(`${LOGIN_BASE}/${encodeURIComponent(creds.azureTenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  const text = await res.text()
  if (!res.ok) {
    // The body carries why, and the why matters: consent not granted reads
    // very differently from a wrong secret, and an administrator can only
    // act on the difference.
    throw new GraphError(res.status, 'token_request_failed',
      `Could not obtain a Microsoft Graph token for tenant ${creds.azureTenantId}: ${text.slice(0, 400)}`)
  }

  const json = JSON.parse(text) as { access_token: string; expires_in?: number }
  const ttl = (json.expires_in ?? 3600) * 1000
  tokenCache.set(creds.azureTenantId, { token: json.access_token, expiresAt: Date.now() + ttl })
  return json.access_token
}

/** Drop cached tokens — used by tests and after a consent change. */
export function clearTokenCache() { tokenCache.clear() }

/* ── requests ─────────────────────────────────────────────────────── */

function retryAfterSeconds(res: Response): number {
  const header = res.headers.get('retry-after')
  const parsed = Number(header)
  if (Number.isFinite(parsed) && parsed > 0) return Math.min(parsed, MAX_RETRY_AFTER_S)
  return 10
}

/**
 * One Graph request, waiting out throttling.
 *
 * `url` may be absolute — delta hands back complete nextLink and deltaLink
 * URLs and they must be followed exactly as given, not rebuilt.
 */
async function graphFetch(
  creds: GraphCredentials,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const absolute = url.startsWith('http') ? url : `${GRAPH_BASE}${url}`

  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken(creds)
    const res = await fetch(absolute, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    // 429 is Graph; 503 is SharePoint saying the same thing.
    if ((res.status === 429 || res.status === 503) && attempt < MAX_THROTTLE_RETRIES) {
      const wait = retryAfterSeconds(res)
      console.log(`[graph] throttled (${res.status}), waiting ${wait}s then retrying: ${absolute.slice(0, 120)}`)
      await new Promise(r => setTimeout(r, wait * 1000))
      continue
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let code: string | undefined
      try { code = (JSON.parse(text) as { error?: { code?: string } }).error?.code } catch { /* not JSON */ }
      throw new GraphError(res.status, code, `Graph ${res.status} on ${absolute.slice(0, 160)}: ${text.slice(0, 300)}`)
    }

    return res
  }
}

async function graphJson<T>(creds: GraphCredentials, url: string): Promise<T> {
  const res = await graphFetch(creds, url)
  return await res.json() as T
}

/* ── finding a library ────────────────────────────────────────────── */

export interface GraphSite {
  id: string
  name?: string
  displayName?: string
  webUrl?: string
}

export interface GraphDrive {
  id: string
  name?: string
  driveType?: string
  webUrl?: string
}

/**
 * Sites the application has been granted access to.
 *
 * Under Sites.Selected an administrator grants the application access to
 * named sites, so this returns only those — which is the point. The same
 * call under Sites.Read.All would return the customer's entire estate.
 */
export async function listSites(creds: GraphCredentials, search = ''): Promise<GraphSite[]> {
  const query = search.trim()
    ? `/sites?search=${encodeURIComponent(search.trim())}`
    : '/sites?search=*'
  const json = await graphJson<{ value: GraphSite[] }>(creds, query)
  return json.value ?? []
}

/** The document libraries inside one site. */
export async function listDrives(creds: GraphCredentials, siteId: string): Promise<GraphDrive[]> {
  const json = await graphJson<{ value: GraphDrive[] }>(creds, `/sites/${encodeURIComponent(siteId)}/drives`)
  return json.value ?? []
}

export async function getSite(creds: GraphCredentials, siteId: string): Promise<GraphSite> {
  return await graphJson<GraphSite>(creds, `/sites/${encodeURIComponent(siteId)}`)
}

/* ── the change feed ──────────────────────────────────────────────── */

export interface GraphDriveItem {
  id: string
  name?: string
  eTag?: string
  size?: number
  /** Present on folders. Folders carry no content and are skipped. */
  folder?: { childCount?: number }
  file?: { mimeType?: string }
  /** Present when the item was deleted. */
  deleted?: { state?: string }
  parentReference?: { path?: string; driveId?: string }
  lastModifiedDateTime?: string
  webUrl?: string
}

export interface DeltaPage {
  items: GraphDriveItem[]
  /** Follow this for the next page of the same enumeration. */
  nextLink: string | null
  /** Present on the final page: the cursor to store for next time. */
  deltaLink: string | null
}

/**
 * One page of changes.
 *
 * Pass the stored deltaLink to get only what changed since. Pass nothing
 * to read the library from the beginning.
 *
 * A cursor that has gone stale raises GraphError with resyncRequired set,
 * which the caller answers by discarding it and starting again — Graph
 * documents this as 410 Gone and it is a normal event after a long gap,
 * not a fault.
 */
export async function getDeltaPage(
  creds: GraphCredentials,
  driveId: string,
  link?: string | null,
): Promise<DeltaPage> {
  const url = link && link.trim()
    ? link
    : `/drives/${encodeURIComponent(driveId)}/root/delta`

  const json = await graphJson<{
    value?: GraphDriveItem[]
    '@odata.nextLink'?: string
    '@odata.deltaLink'?: string
  }>(creds, url)

  return {
    items: json.value ?? [],
    nextLink: json['@odata.nextLink'] ?? null,
    deltaLink: json['@odata.deltaLink'] ?? null,
  }
}

/** The bytes of one file. */
export async function downloadItem(
  creds: GraphCredentials,
  driveId: string,
  itemId: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await graphFetch(
    creds,
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
  )
  const buf = Buffer.from(await res.arrayBuffer())
  return {
    bytes: buf,
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  }
}

/**
 * Whether a delta entry is a file worth importing.
 *
 * Folders, deletions and the drive root all appear in the feed and none of
 * them has content.
 */
export function isImportableFile(item: GraphDriveItem): boolean {
  if (item.deleted) return false
  if (item.folder) return false
  if (!item.file) return false
  return true
}
