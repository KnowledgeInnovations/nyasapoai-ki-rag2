import { createClient } from '@supabase/supabase-js'

/**
 * createBrowserClient() (./client.ts) hardcodes flowType: 'pkce' with no way
 * to override it — fine for sign-in itself (no email link involved), but
 * wrong for anything that emails a confirmation link (signup, password
 * reset, email change): PKCE binds the link to a code verifier stored in
 * *this* browser, so clicking it from a different browser or device — the
 * realistic case for a link delivered by email — fails with "PKCE code
 * verifier not found in storage." Use this throwaway implicit-flow client
 * for those specific calls instead, so the resulting link carries its own
 * token and works from anywhere it's opened.
 *
 * Not persisted/auto-refreshed — it exists only for the one call that
 * creates it.
 */
export function createImplicitClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  )
}
