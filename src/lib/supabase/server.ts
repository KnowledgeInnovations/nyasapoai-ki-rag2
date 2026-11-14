import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import { createHash } from 'node:crypto'

/**
 * The signed-in user, as proven by the verified access token.
 *
 * Deliberately not Supabase's `User`: this is built from the JWT's claims,
 * and the JWT does not carry everything that type promises (created_at, for
 * one). Returning a `User` with invented fields would be a small lie that
 * somebody later relies on. These are the fields the token actually proves,
 * and they are the only ones this application reads.
 */
export interface AuthenticatedUser {
  id: string
  email: string | null
  phone: string | null
  role: string | null
  app_metadata: Record<string, unknown>
  user_metadata: Record<string, unknown>
}

/**
 * A string out of user_metadata, or null. That object is free-form — anything
 * can be written into it from the client — so reading a field is a narrowing,
 * not an assumption that it is there and is text.
 */
export function metaString(user: AuthenticatedUser | null | undefined, key: string): string | null {
  const value = user?.user_metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}
import { normalizeRole, type Role } from '@/lib/roles'
import { cookieDomainForHost, subdomainFromHost } from '@/lib/domain'
import { workspaceAccess } from '@/lib/workspaceStatus'
import { isSessionEmailMfaVerified } from '@/lib/emailMfa'
import { isEmailMfaEnabled } from '@/lib/emailMfaFlag'

// ── Module-level caches ────────────────────────────────────────
// Survive across requests within the same server process.
// React.cache() deduplicates within ONE request; these caches deduplicate
// across requests, reducing Supabase Auth round-trips dramatically.

type Entry<T> = { v: T; exp: number }

const USER_TTL       = 30_000  // 30 s  — auth check
const MEMBERSHIP_TTL = 300_000 // 5 min — membership rarely changes
const TENANT_TTL     = 300_000 // 5 min — tenant name/subdomain rarely changes

const userCache       = new Map<string, Entry<AuthenticatedUser | null>>()
const membershipCache = new Map<string, Entry<{ tenant_id: string; role: Role } | null>>()
const tenantCache      = new Map<string, Entry<{ id: string; name: string; subdomain: string; plan: string | null; description: string | null; is_platform: boolean; email_domains: string[] } | null>>()
const subdomainTenantCache = new Map<string, Entry<{ id: string; name: string; subdomain: string } | null>>()

/**
 * A cache key bound to the exact session cookies presented.
 *
 * This used to be the last 48 characters of the joined cookie values, on the
 * belief that the JWT signature lived there. It does not: @supabase/ssr
 * stores the whole session as base64 JSON with `user` as the final key, so
 * the tail decodes to the end of the user object — `…:51.022573Z",
 * "is_anonymous":false}}` — part of an updated_at timestamp and a constant.
 * That is shared shape across users, not a secret, and a cookie of any
 * content ending in someone else's tail was served their verified identity
 * from this cache without its token ever being checked.
 *
 * A digest of every sb- cookie (name and value) binds the entry to the full
 * session, access token included. A refreshed token is a new key, which is
 * one cache miss and nothing worse.
 */
function authKey(cookieStore: Awaited<ReturnType<typeof cookies>>): string {
  const parts = cookieStore.getAll()
    .filter(c => c.name.startsWith('sb-'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => `${c.name}=${c.value}`)
    .join(';')
  return parts ? createHash('sha256').update(parts).digest('base64url') : ''
}

function evict<T>(map: Map<string, Entry<T>>, maxSize = 400) {
  if (map.size < maxSize) return
  const cutoff = Date.now()
  for (const [k, v] of map) if (v.exp <= cutoff) map.delete(k)
}

// ── One Supabase client per request ───────────────────────────
export const createClient = cache(async () => {
  const cookieStore = await cookies()
  const host = (await headers()).get('host')
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { domain: cookieDomainForHost(host) },
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
})

/**
 * The verified claims of the current access token, read once per request.
 * Everything that needs identity goes through here rather than reading the
 * session, which is unverified.
 */
export const getAuthClaims = cache(async () => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  return data?.claims ?? null
})

// ── getUser — cached 30 s across requests ─────────────────────
export const getUser = cache(async () => {
  const cookieStore = await cookies()
  const key = authKey(cookieStore)

  if (key) {
    const hit = userCache.get(key)
    if (hit && hit.exp > Date.now()) return hit.v
  }

  // getClaims(), not getSession().user.
  //
  // The original reasoning for avoiding getUser() still holds: it is a
  // network round-trip to /auth/v1/user on every request, and can trigger a
  // refresh that exhausts rate limits when the refresh token is stale. But
  // reading `.user` off getSession() took the user straight from the cookie
  // without verifying anything, which is why Supabase wrapped that property
  // in a warning proxy — one line of log per authenticated request, on every
  // route, saying so.
  //
  // getClaims() keeps the speed and removes the problem. This project signs
  // with ES256, so it fetches the JWKS once, caches it, and verifies the
  // signature locally with WebCrypto — no per-request network call, and the
  // claims are actually proven rather than assumed. (On a symmetric-key
  // project it falls back to a verified getUser() call, which is slower but
  // still correct.)
  const claims = await getAuthClaims()
  const user: AuthenticatedUser | null = claims?.sub
    ? {
        id: claims.sub,
        email: (claims.email as string | undefined) ?? null,
        phone: (claims.phone as string | undefined) ?? null,
        role: (claims.role as string | undefined) ?? null,
        app_metadata: (claims.app_metadata as Record<string, unknown> | undefined) ?? {},
        user_metadata: (claims.user_metadata as Record<string, unknown> | undefined) ?? {},
      }
    : null

  if (key) {
    evict(userCache)
    userCache.set(key, { v: user, exp: Date.now() + USER_TTL })
  }

  return user
})

/**
 * Does this request need a step-up to two-factor before it is let through?
 *
 * The layout used to ask getAuthenticatorAssuranceLevel() with no argument,
 * which reads session.user.factors straight out of the cookie. That is not
 * only what Supabase's "could be insecure" warning was about — one line per
 * authenticated request, on every route — it is a real weakness: the stored
 * session JSON is not signature-protected as a whole, so a tampered cookie
 * could keep a valid access token while claiming the account has no
 * enrolled factors, and walk past the step-up.
 *
 * Given the token, the very same function asks the Auth server instead and
 * trusts nothing local. The cost is one network call, so it is only paid
 * when it can change the answer: a session already at aal2 has stepped up,
 * and there is nothing left to check.
 */
export const needsMfaStepUp = cache(async (): Promise<boolean> => {
  const supabase = await createClient()

  // The access token, not the user — reading access_token off the session is
  // not what the warning is about, and the token is signed.
  const { data: { session } } = await supabase.auth.getSession()
  const accessToken = session?.access_token
  if (!accessToken) return false

  const claims = await getAuthClaims()
  if (claims?.aal === 'aal2') return false

  const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(accessToken)
  if (error) {
    // Refusing to guess. Failing open would let a 2FA account through on a
    // transient error; failing closed sends them to a challenge they can
    // complete. Closed is the safe direction for an authentication gate.
    console.error('[auth] could not determine assurance level, requiring step-up:', error.message)
    return true
  }
  return !!aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2'
})

// ── getSessionId — the JWT's session_id claim ──────────────────
// Stable across token refreshes within one login, distinct per sign-in.
// Used to key email_mfa_verified_sessions (see emailMfa.ts) — the closest
// equivalent we can produce for a factor type (email) Supabase's own aal
// system has no knowledge of. Decoded locally, not signature-verified —
// consistent with src/lib/supabase/middleware.ts's existing routing-only
// JWT decoding; actual authentication is still enforced by getUser() before
// any of this ever runs.
export const getSessionId = cache(async (): Promise<string | null> => {
  // The same verified claims as getUser(), rather than splitting the token
  // apart by hand. Same value, now signature-checked.
  const claims = await getAuthClaims()
  const sessionId = claims?.session_id
  return typeof sessionId === 'string' ? sessionId : null
})

// ── getMembership — cached 5 min across requests ───────────────
//
// A person can belong to more than one workspace: creating one is limited to
// a single workspace per account, but an invitation can add another, and one
// did. This used to end in .single(), which errors when a second row exists
// rather than returning either — so the moment anyone was invited into a
// second workspace, this returned null and every protected route decided
// they had no workspace at all. Observed on a real account that was a member
// of two: locked out of the product entirely, including the workspace they
// had been using for a week.
//
// Which workspace is meant is not a guess: the host says so. Each workspace
// lives on its own subdomain (see src/lib/domain.ts), so the subdomain being
// visited selects the membership. Without one — on the root domain — the
// oldest membership is used, deterministically, so the answer does not
// change between requests.
//
// This is the RAW record: it says which workspace a person belongs to and
// nothing about whether they may use it right now. Almost every caller wants
// getMembership() below instead. Use this only where the caller decides
// access itself — the app layout (which redirects to the right page), the
// workspace-unavailable page, and paying for a closed workspace.
export const getMembershipRecord = cache(async () => {
  const user = await getUser()
  if (!user) return null

  // The cache key has to include the host. Keyed on the user alone, a person
  // in two workspaces would be served whichever one they visited first for
  // the next five minutes, on every subdomain.
  const host = (await headers()).get('host')
  const subdomain = subdomainFromHost(host)
  const cacheKey = `${user.id}::${subdomain ?? ''}`

  const hit = membershipCache.get(cacheKey)
  if (hit && hit.exp > Date.now()) return hit.v

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('memberships')
    .select('tenant_id, role, created_at, tenants:tenant_id(subdomain)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  // A transient query failure (network blip, rate limit, momentary outage)
  // is not the same as "this user has no membership" — caching it as such
  // would silently strip a real user's role/tenant for MEMBERSHIP_TTL on
  // whichever server instance hit the error.
  if (error) {
    console.error('getMembership query failed', { userId: user.id, error })
    return null
  }

  type Row = {
    tenant_id: string
    role: string
    created_at: string
    tenants: { subdomain: string } | { subdomain: string }[] | null
  }
  const rows = (data ?? []) as Row[]
  const subdomainOf = (r: Row) => (Array.isArray(r.tenants) ? r.tenants[0] : r.tenants)?.subdomain

  // The workspace whose subdomain is being visited, or the oldest when the
  // host names none. A subdomain the user is not a member of resolves to no
  // membership, which is correct: they are not in that workspace.
  const chosen = subdomain
    ? rows.find(r => subdomainOf(r) === subdomain) ?? null
    : rows[0] ?? null

  const val = chosen ? { tenant_id: chosen.tenant_id, role: normalizeRole(chosen.role) } : null
  evict(membershipCache)
  membershipCache.set(cacheKey, { v: val, exp: Date.now() + MEMBERSHIP_TTL })

  // The oldest membership, whatever host this is. Cached under a key the
  // host cannot collide with, so one query answers both questions.
  const home = rows[0] ? { tenant_id: rows[0].tenant_id, role: normalizeRole(rows[0].role) } : null
  homeMembershipCache.set(user.id, { v: home, exp: Date.now() + MEMBERSHIP_TTL })

  return val
})

const homeMembershipCache = new Map<string, Entry<{ tenant_id: string; role: Role } | null>>()

/**
 * A workspace this person belongs to, ignoring which host they are on.
 *
 * getMembershipRecord() answers "is this person a member of the workspace
 * whose subdomain they just opened", and returns null when they are not.
 * That null means two very different things — "not a member of THIS one"
 * and "not a member of ANY" — and treating them alike is what sent a
 * signed-in person who opened someone else's subdomain to a page offering
 * to create an organisation, which is not what they were trying to do.
 *
 * Call this only after getMembershipRecord() has come back null: it is the
 * second question, and the answer is already cached by the first call.
 */
export const getHomeMembership = cache(async () => {
  const user = await getUser()
  if (!user) return null

  const hit = homeMembershipCache.get(user.id)
  if (hit && hit.exp > Date.now()) return hit.v

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('memberships')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)

  // Same reasoning as getMembershipRecord: a query failure is not the same
  // as "belongs to nothing", and caching it as such would strip a real
  // person's workspace for the whole TTL.
  if (error) {
    console.error('getHomeMembership query failed', { userId: user.id, error })
    return null
  }

  const row = (data ?? [])[0] as { tenant_id: string; role: string } | undefined
  const val = row ? { tenant_id: row.tenant_id, role: normalizeRole(row.role) } : null
  evict(homeMembershipCache)
  homeMembershipCache.set(user.id, { v: val, exp: Date.now() + MEMBERSHIP_TTL })
  return val
})

// ── secondFactorSatisfied — has this session finished signing in? ──────
// True when the account needs no second factor, or this session has passed
// it (TOTP via Supabase's aal2, email via email_mfa_verified_sessions).
//
// Only a pass is cached across requests, keyed to the exact session (see
// authKey), for the same 30 s as the user cache. A failure is never cached:
// the very next request after the challenge is completed must see it.
const secondFactorCache = new Map<string, Entry<true>>()

export const secondFactorSatisfied = cache(async (): Promise<boolean> => {
  const user = await getUser()
  if (!user) return false

  const key = authKey(await cookies())
  const hit = key ? secondFactorCache.get(key) : undefined
  if (hit && hit.exp > Date.now()) return true

  let ok: boolean
  if (isEmailMfaEnabled(user)) {
    const sessionId = await getSessionId()
    ok = !!sessionId && await isSessionEmailMfaVerified(
      createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      ),
      sessionId,
    )
  } else {
    ok = !(await needsMfaStepUp())
  }

  if (ok && key) {
    evict(secondFactorCache)
    secondFactorCache.set(key, { v: true, exp: Date.now() + USER_TTL })
  }
  return ok
})

// ── getMembership — the membership, only if it may be used right now ───
//
// Two gates used to live only in the (app) layout: the two-factor step-up and
// the workspace lifecycle (suspended, unpaid, not yet provisioned). A layout
// guards pages and nothing else, so every /api route — chat over the whole
// corpus, signed download links, uploads, user management — answered a
// session that had only a password, and a workspace closed for non-payment
// kept full use of the API. This is the one function every protected route
// already calls, so the gates live here and no route can forget them.
//
// Under the layout this costs nothing: the layout has asked the same
// request-cached questions already.
export const getMembership = cache(async () => {
  const record = await getMembershipRecord()
  if (!record) return null
  if (!(await secondFactorSatisfied())) return null
  const lifecycle = await getWorkspaceStatus(record.tenant_id)
  if (!workspaceAccess(lifecycle.status, lifecycle.access_until).allowed) return null
  return record
})

// ── getTenant — cached 5 min across requests ───────────────────
export const getTenant = cache(async (tenantId: string) => {
  const hit = tenantCache.get(tenantId)
  if (hit && hit.exp > Date.now()) return hit.v

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name, subdomain, plan, description, is_platform, email_domains')
    .eq('id', tenantId)
    .single()

  // Same reasoning as getMembership above — don't let a transient query
  // failure get cached as "this tenant doesn't exist" for TENANT_TTL.
  if (error) {
    console.error('getTenant query failed', { tenantId, error })
    return null
  }

  const val = data as { id: string; name: string; subdomain: string; plan: string | null; description: string | null; is_platform: boolean; email_domains: string[] } | null
  evict(tenantCache)
  tenantCache.set(tenantId, { v: val, exp: Date.now() + TENANT_TTL })
  return val
})

// ── getTenantBySubdomain — public lookup for unauthenticated visitors ──
// Used by the login page to brand itself for a tenant's subdomain. Reads
// via the service role since the visitor isn't authenticated yet (tenants
// RLS only allows members to read their own tenant row).
export const getTenantBySubdomain = cache(async (subdomain: string) => {
  const hit = subdomainTenantCache.get(subdomain)
  if (hit && hit.exp > Date.now()) return hit.v

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data, error } = await service
    .from('tenants')
    .select('id, name, subdomain')
    .eq('subdomain', subdomain)
    .maybeSingle()

  // Don't cache a transient query failure as "no tenant at this subdomain"
  // — that would silently show the generic landing page (instead of the
  // personalized one) to that tenant's visitors for TENANT_TTL, on
  // whichever server instance hit the error.
  if (error) {
    console.error('getTenantBySubdomain query failed', { subdomain, error })
    return null
  }

  evict(subdomainTenantCache)
  subdomainTenantCache.set(subdomain, { v: data, exp: Date.now() + TENANT_TTL })
  return data
})

// ── getTenantLogoPath — per-subdomain favicon lookup ──────────────────
// Deliberately a separate query from getTenantBySubdomain rather than another
// column on it: that one is on the critical path for the login page and the
// marketing landing page, and adding a column to its select would make both
// fail outright on any deployment where migration 033 hasn't run yet. Here a
// missing column just means "no custom logo" and the caller falls back to the
// Nyansa AI default, so code and migration can land in either order.
//
// Cached per subdomain like the lookups above; errors are never cached (see
// getTenantBySubdomain for why).
const subdomainLogoCache = new Map<string, Entry<string | null>>()

export const getTenantLogoPath = cache(async (subdomain: string): Promise<string | null> => {
  const hit = subdomainLogoCache.get(subdomain)
  if (hit && hit.exp > Date.now()) return hit.v

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data, error } = await service
    .from('tenants')
    .select('logo_path')
    .eq('subdomain', subdomain)
    .maybeSingle()

  if (error) {
    // Includes "column does not exist" before migration 033 has run — degrade
    // to the default icon rather than 500ing on a favicon request.
    console.error('getTenantLogoPath query failed', { subdomain, error })
    return null
  }

  const path = (data as { logo_path: string | null } | null)?.logo_path ?? null
  evict(subdomainLogoCache)
  subdomainLogoCache.set(subdomain, { v: path, exp: Date.now() + TENANT_TTL })
  return path
})

/** Drop a tenant's cached logo path — call after changing it. */
export function invalidateTenantLogo(subdomain: string) {
  subdomainLogoCache.delete(subdomain)
}

// ── touchLastActive — debounced "is this person actually using the app
// right now" signal for the Users admin page ────────────────────────
// auth.users.last_sign_in_at only updates on sign-in, not on ongoing use —
// useless here since sessions persist 400 days (see middleware.ts), so a
// user signed in a week ago and active every day since would wrongly look
// "pending"/stale by that field alone. memberships.last_active_at is
// touched on every protected-route request instead. Debounced per-process
// (same pattern as the caches above) so this doesn't add a DB write to
// every single page navigation — only once per ACTIVITY_DEBOUNCE_MS per
// user. Needs the service client: memberships has no UPDATE policy in RLS
// (only "read own"), since no normal user-facing flow should ever write to
// it directly.
const ACTIVITY_DEBOUNCE_MS = 60_000
const lastActivityWrite = new Map<string, Entry<true>>()

export async function touchLastActive(userId: string, tenantId: string): Promise<void> {
  const hit = lastActivityWrite.get(userId)
  if (hit && hit.exp > Date.now()) return

  evict(lastActivityWrite)
  lastActivityWrite.set(userId, { v: true, exp: Date.now() + ACTIVITY_DEBOUNCE_MS })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  await service.from('memberships')
    .update({ last_active_at: new Date().toISOString() })
    .eq('user_id', userId).eq('tenant_id', tenantId)
}

// Drop a user's cached membership (role/tenant) immediately — call after
// updating or removing a membership row via the service client, which
// bypasses getMembership()'s normal read-through caching. Without this, the
// affected user's role/permission checks keep returning the stale cached
// value for up to MEMBERSHIP_TTL.
export function invalidateMembership(userId: string) {
  // Entries are keyed by user AND host, so one delete is not enough — every
  // host this user has been seen on has to go, or a stale role survives on
  // the subdomains they did not happen to request from.
  for (const key of membershipCache.keys()) {
    if (key === userId || key.startsWith(`${userId}::`)) membershipCache.delete(key)
  }
}

// Drop a tenant's cached row immediately — call after updating it (e.g.
// email_domains) via the service client, which bypasses getTenant()'s
// normal read-through caching.
export function invalidateTenant(tenantId: string) {
  tenantCache.delete(tenantId)
}

// ── getWorkspaceStatus — lifecycle + grace window for one tenant ───────
// Separate query from getTenant() for the same reason getTenantLogoPath is
// separate: getTenant() is on the critical path for every authenticated
// request, and adding columns to its select would make the whole app fail on
// any deployment where migration 034 has not yet run. Here a missing column
// means "no billing columns yet", which resolves to active — so the code and
// the migration can land in either order without an outage.
//
// Errors are never cached, for the reason given on getTenantBySubdomain.
const workspaceStatusCache = new Map<string, Entry<{ status: string | null; access_until: string | null }>>()

export const getWorkspaceStatus = cache(async (tenantId: string) => {
  const hit = workspaceStatusCache.get(tenantId)
  if (hit && hit.exp > Date.now()) return hit.v

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('status, access_until')
    .eq('id', tenantId)
    .maybeSingle()

  if (error) {
    // Includes "column does not exist" before migration 034 — treat as active
    // rather than locking every workspace out over a schema mismatch.
    console.error('getWorkspaceStatus query failed', { tenantId, error })
    return { status: null, access_until: null }
  }

  const val = (data ?? { status: null, access_until: null }) as { status: string | null; access_until: string | null }
  evict(workspaceStatusCache)
  // Short TTL: restoring access after payment should take effect promptly,
  // not after the 5 minutes the slower-moving tenant lookups use.
  workspaceStatusCache.set(tenantId, { v: val, exp: Date.now() + 30_000 })
  return val
})

/** Drop a workspace's cached status — call right after changing it. */
export function invalidateWorkspaceStatus(tenantId: string) {
  workspaceStatusCache.delete(tenantId)
}
