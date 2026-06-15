import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { cookieDomainForHost } from '@/lib/domain'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { domain: cookieDomainForHost(request.headers.get('host')) },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getSession() reads the JWT from the cookie locally — no network call (~0ms).
  // getUser() (the old approach) made a round-trip to Supabase Auth on every
  // navigation, adding 2–8 seconds of latency. Security is still enforced in
  // server components, which call getUser() to verify the token when it matters.
  const { data: { session }, error } = await supabase.auth.getSession()

  // A stale/duplicate auth cookie (e.g. left over from the cookie-Domain
  // change to share sessions across subdomains) can leave a dead refresh
  // token that fails on every request, burning the Auth rate limit. Clear
  // all sb-* cookies so the browser drops it and the user can log in fresh.
  if (error?.code === 'refresh_token_not_found') {
    const host = request.headers.get('host')
    for (const cookie of request.cookies.getAll()) {
      if (!cookie.name.startsWith('sb-')) continue
      supabaseResponse.cookies.set(cookie.name, '', { maxAge: 0 })
      supabaseResponse.cookies.set(cookie.name, '', { maxAge: 0, domain: cookieDomainForHost(host) })
    }
  }

  return { supabaseResponse, user: session?.user ?? null }
}
