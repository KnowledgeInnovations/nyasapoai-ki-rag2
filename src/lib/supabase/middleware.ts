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
  // Security is enforced in server components and API routes via getUser().
  //
  // Suppress two specific noise sources during the await:
  // 1. console.error({ code: 'refresh_token_not_found' }): fired internally by
  //    @supabase/ssr's _emitInitialSession IIFE when a stale refresh token is
  //    detected before our getSession() even runs.
  // 2. console.warn("Using the user object as returned from supabase.auth.getSession()"):
  //    Supabase's advisory warning about server-side JWT trust — intentionally
  //    accepted here for performance; server components call getUser() when it matters.
  const _origError = console.error
  const _origWarn = console.warn
  console.error = (...args: Parameters<typeof console.error>) => {
    const e = args[0]
    if (e != null && typeof e === 'object' && (e as { code?: string }).code === 'refresh_token_not_found') return
    _origError.apply(console, args)
  }
  console.warn = (...args: Parameters<typeof console.warn>) => {
    if (typeof args[0] === 'string' && args[0].startsWith('Using the user object as returned from supabase.auth.getSession()')) return
    _origWarn.apply(console, args)
  }
  let session = null
  let staleSession = false
  try {
    const { data, error } = await supabase.auth.getSession()
    session = data.session
    staleSession = error?.code === 'refresh_token_not_found'
  } catch (err) {
    if (err instanceof Object && (err as { code?: string }).code === 'refresh_token_not_found') {
      staleSession = true
    } else {
      throw err
    }
  } finally {
    console.error = _origError
    console.warn = _origWarn
  }

  // Only clear sb-* cookies when we know for certain the refresh token is dead
  // (explicit refresh_token_not_found error). Clearing on any null session would
  // log out users whose cookies are valid but whose access token is mid-refresh.
  if (staleSession) {
    const host = request.headers.get('host')
    const sbCookieNames = request.cookies.getAll()
      .map(c => c.name)
      .filter(name => name.startsWith('sb-'))
    for (const name of sbCookieNames) request.cookies.delete(name)
    supabaseResponse = NextResponse.next({ request })
    for (const name of sbCookieNames) {
      supabaseResponse.cookies.set(name, '', { maxAge: 0 })
      supabaseResponse.cookies.set(name, '', { maxAge: 0, domain: cookieDomainForHost(host) })
    }
    session = null
  }

  return { supabaseResponse, user: session?.user ?? null }
}
