import { createBrowserClient } from '@supabase/ssr'
import { cookieDomainForHost } from '@/lib/domain'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { domain: cookieDomainForHost(typeof window !== 'undefined' ? window.location.host : undefined) } }
  )
}
