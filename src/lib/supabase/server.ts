import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import { normalizeRole, type Role } from '@/lib/roles'
import { cookieDomainForHost } from '@/lib/domain'

// ── Module-level caches ────────────────────────────────────────
// Survive across requests within the same server process.
// React.cache() deduplicates within ONE request; these caches deduplicate
// across requests, reducing Supabase Auth round-trips dramatically.

type Entry<T> = { v: T; exp: number }

const USER_TTL       = 30_000  // 30 s  — auth check
const MEMBERSHIP_TTL = 300_000 // 5 min — membership rarely changes
const TENANT_TTL     = 300_000 // 5 min — tenant name/subdomain rarely changes

const userCache       = new Map<string, Entry<User | null>>()
const membershipCache = new Map<string, Entry<{ tenant_id: string; role: Role } | null>>()
const tenantCache      = new Map<string, Entry<{ id: string; name: string; subdomain: string; description: string | null; is_platform: boolean; email_domains: string[] } | null>>()
const subdomainTenantCache = new Map<string, Entry<{ id: string; name: string; subdomain: string } | null>>()

/** Derive a compact, unique cache key from the Supabase session cookies. */
function authKey(cookieStore: Awaited<ReturnType<typeof cookies>>): string {
  const parts = cookieStore.getAll()
    .filter(c => c.name.startsWith('sb-'))
    .map(c => c.value)
    .join('')
  // JWT signatures live in the tail — last 48 chars are unique per token
  return parts.length > 48 ? parts.slice(-48) : parts
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

// ── getUser — cached 30 s across requests ─────────────────────
export const getUser = cache(async () => {
  const cookieStore = await cookies()
  const key = authKey(cookieStore)

  if (key) {
    const hit = userCache.get(key)
    if (hit && hit.exp > Date.now()) return hit.v
  }

  const supabase = await createClient()
  // Use getSession() (local JWT verification, no network call) instead of
  // getUser() (which makes a network round-trip to /auth/v1/user and can
  // trigger a refresh attempt that exhausts rate limits when the refresh
  // token is stale). Middleware already handles token refresh and writes
  // updated cookies to the forwarded request before server components run.
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null

  if (key) {
    evict(userCache)
    userCache.set(key, { v: user, exp: Date.now() + USER_TTL })
  }

  return user
})

// ── getMembership — cached 5 min across requests ───────────────
export const getMembership = cache(async () => {
  const user = await getUser()
  if (!user) return null

  const hit = membershipCache.get(user.id)
  if (hit && hit.exp > Date.now()) return hit.v

  const supabase = await createClient()
  const { data } = await supabase
    .from('memberships')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .single()

  const raw = data as { tenant_id: string; role: string } | null
  const val = raw ? { tenant_id: raw.tenant_id, role: normalizeRole(raw.role) } : null
  evict(membershipCache)
  membershipCache.set(user.id, { v: val, exp: Date.now() + MEMBERSHIP_TTL })
  return val
})

// ── getTenant — cached 5 min across requests ───────────────────
export const getTenant = cache(async (tenantId: string) => {
  const hit = tenantCache.get(tenantId)
  if (hit && hit.exp > Date.now()) return hit.v

  const supabase = await createClient()
  const { data } = await supabase
    .from('tenants')
    .select('id, name, subdomain, description, is_platform, email_domains')
    .eq('id', tenantId)
    .single()

  const val = data as { id: string; name: string; subdomain: string; description: string | null; is_platform: boolean; email_domains: string[] } | null
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
  const { data } = await service
    .from('tenants')
    .select('id, name, subdomain')
    .eq('subdomain', subdomain)
    .maybeSingle()

  evict(subdomainTenantCache)
  subdomainTenantCache.set(subdomain, { v: data, exp: Date.now() + TENANT_TTL })
  return data
})

// Drop a user's cached membership (role/tenant) immediately — call after
// updating or removing a membership row via the service client, which
// bypasses getMembership()'s normal read-through caching. Without this, the
// affected user's role/permission checks keep returning the stale cached
// value for up to MEMBERSHIP_TTL.
export function invalidateMembership(userId: string) {
  membershipCache.delete(userId)
}

// Drop a tenant's cached row immediately — call after updating it (e.g.
// email_domains) via the service client, which bypasses getTenant()'s
// normal read-through caching.
export function invalidateTenant(tenantId: string) {
  tenantCache.delete(tenantId)
}
