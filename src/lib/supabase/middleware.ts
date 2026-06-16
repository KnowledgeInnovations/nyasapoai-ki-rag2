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
  //
  // The @supabase/ssr createServerClient registers an internal onAuthStateChange
  // listener whose _emitInitialSession fires as a floating async IIFE. When the
  // refresh token is stale it acquires the lock first, calls console.error()
  // internally, and returns — before our getSession() even runs. Suppress that
  // specific error code for the duration of the await so Vercel logs stay clean.
  // The stale-cookie path below handles the actual cookie clearing.
  const _origError = console.error
  console.error = (...args: Parameters<typeof console.error>) => {
    const e = args[0]
    if (e != null && typeof e === 'object' && (e as { code?: string }).code === 'refresh_token_not_found') return
    _origError.apply(console, args)
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
  }

  // A stale/duplicate auth cookie (e.g. left over from the cookie-Domain
  // change to share sessions across subdomains) can leave a dead refresh
  // token that fails on every request, burning the Auth rate limit. Drop the
  // cookies from both the forwarded request (so this request's server
  // components see a clean, logged-out state) and the response (so the
  // browser stops sending them too).
  if (staleSession) {
    const host = request.headers.get('host')
    const staleCookieNames = request.cookies.getAll()
      .map(c => c.name)
      .filter(name => name.startsWith('sb-'))

    for (const name of staleCookieNames) request.cookies.delete(name)
    supabaseResponse = NextResponse.next({ request })
    for (const name of staleCookieNames) {
      supabaseResponse.cookies.set(name, '', { maxAge: 0 })
      supabaseResponse.cookies.set(name, '', { maxAge: 0, domain: cookieDomainForHost(host) })
    }
    session = null
  }

  return { supabaseResponse, user: session?.user ?? null }
}
