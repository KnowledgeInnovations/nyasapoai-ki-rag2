import { createServerClient } from '@supabase/ssr'
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
const tenantCache      = new Map<string, Entry<{ id: string; name: string; subdomain: string; description: string | null; is_platform: boolean } | null>>()

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
  const { data } = await supabase.auth.getUser()

  if (key) {
    evict(userCache)
    userCache.set(key, { v: data.user, exp: Date.now() + USER_TTL })
  }

  return data.user
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
    .select('id, name, subdomain, description, is_platform')
    .eq('id', tenantId)
    .single()

  const val = data as { id: string; name: string; subdomain: string; description: string | null; is_platform: boolean } | null
  evict(tenantCache)
  tenantCache.set(tenantId, { v: val, exp: Date.now() + TENANT_TTL })
  return val
})

// Drop a user's cached membership (role/tenant) immediately — call after
// updating or removing a membership row via the service client, which
// bypasses getMembership()'s normal read-through caching. Without this, the
// affected user's role/permission checks keep returning the stale cached
// value for up to MEMBERSHIP_TTL.
export function invalidateMembership(userId: string) {
  membershipCache.delete(userId)
}
