/**
 * Request-scoped usage attribution for route handlers.
 *
 * Kept separate from src/lib/usage.ts on purpose: this module reaches for
 * next/headers through the server Supabase helpers, which only works inside
 * a request. usage.ts is imported by libraries that also run from scripts and
 * background jobs, and must stay usable there.
 *
 * Wrap a handler in this and every model call beneath it is attributed to the
 * caller's workspace without a single signature change.
 */
import { getUser, getMembership, getTenant } from './supabase/server'
import { withUsage } from './usage'

export async function withRequestUsage<T>(fn: () => Promise<T>): Promise<T> {
  // All three are request-cached, so resolving them here costs essentially
  // nothing even when the handler resolves them again for its own use.
  const [user, membership] = await Promise.all([getUser(), getMembership()])
  const tenant = membership ? await getTenant(membership.tenant_id) : null
  return withUsage(
    {
      tenantId:    membership?.tenant_id ?? null,
      tenantLabel: tenant?.name ?? null,
      userId:      user?.id ?? null,
    },
    fn,
  )
}
