import { type NextRequest, NextResponse } from 'next/server'
import { cookieDomainForHost } from '@/lib/domain'

// createServerClient() is intentionally NOT used here.
//
// Every call to createServerClient() registers an onAuthStateChange listener
// which fires a floating async IIFE (_emitInitialSession). When the access
// token is near expiry, that IIFE calls _callRefreshToken() concurrently with
// our own getSession()/getUser() call. Because Supabase rotates refresh tokens
// on use, whichever call wins consumes the token; the other gets
// refresh_token_not_found. If our call loses the race, we'd then clear the
// cookies that the IIFE just successfully wrote — logging the user out even
// though a valid session exists.
//
// Instead we read the session cookie directly, decode the JWT for routing
// decisions (no signature verification — security is enforced in server
// components and API routes via getUser()), and call the Supabase token
// endpoint directly when a refresh is needed. No client, no IIFE, no race.

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Matches the cookie name @supabase/ssr derives from the project URL.
const PROJECT_REF = (SUPABASE_URL.match(/\/\/([^.]+)/) ?? [])[1] ?? ''
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`

function b64url(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (padded.length % 4)) % 4
  return Buffer.from(padded + '='.repeat(pad), 'base64').toString('utf8')
}

interface RawSession {
  access_token: string
  refresh_token: string
  expires_at?: number
  expires_in?: number
  token_type?: string
  user?: Record<string, unknown>
}

interface JWTClaims { sub?: string; exp?: number }

function readRawSession(request: NextRequest): RawSession | null {
  const all = request.cookies.getAll()

  // Supabase SSR may chunk the cookie into STORAGE_KEY.0, .1, … when the
  // session JSON is too large for a single Set-Cookie header.
  let raw = all.find(c => c.name === STORAGE_KEY)?.value ?? null
  if (!raw) {
    const parts: string[] = []
    for (let i = 0; i < 6; i++) {
      const v = all.find(c => c.name === `${STORAGE_KEY}.${i}`)?.value
      if (!v) break
      parts.push(v)
    }
    if (parts.length) raw = parts.join('')
  }
  if (!raw) return null

  try {
    const json = raw.startsWith('base64-') ? b64url(raw.slice(7)) : raw
    const parsed = JSON.parse(json) as RawSession
    if (!parsed.access_token || !parsed.refresh_token) return null
    return parsed
  } catch {
    return null
  }
}

function jwtClaims(token: string): JWTClaims | null {
  try { return JSON.parse(b64url(token.split('.')[1])) } catch { return null }
}

function clearSbCookies(
  response: NextResponse,
  request: NextRequest,
  host: string | null,
) {
  const domain = cookieDomainForHost(host)
  for (const { name } of request.cookies.getAll()) {
    if (!name.startsWith('sb-')) continue
    // Clear both the domain-scoped and host-only variants
    response.cookies.set(name, '', { maxAge: 0, path: '/', sameSite: 'lax' })
    if (domain) response.cookies.set(name, '', { maxAge: 0, path: '/', sameSite: 'lax', domain })
  }
}

function writeSession(
  response: NextResponse,
  session: RawSession,
  host: string | null,
) {
  const domain = cookieDomainForHost(host)
  // Match @supabase/ssr DEFAULT_COOKIE_OPTIONS exactly so the browser
  // client (createBrowserClient) can still read the session after a
  // server-side refresh. httpOnly:false is intentional — the browser
  // Supabase client must be able to read its own auth cookie.
  const opts = {
    path:     '/',
    httpOnly: false,
    sameSite: 'lax' as const,
    maxAge:   400 * 24 * 60 * 60, // 400 days — matches Supabase SSR default
    ...(domain ? { domain } : {}),
  }

  const json    = JSON.stringify(session)
  const encoded = 'base64-' + Buffer.from(json).toString('base64url')
  const CHUNK   = 3180 // MAX_CHUNK_SIZE from @supabase/ssr

  if (encoded.length <= CHUNK) {
    response.cookies.set(STORAGE_KEY, encoded, opts)
  } else {
    const chunks = encoded.match(new RegExp(`.{1,${CHUNK}}`, 'g')) ?? []
    chunks.forEach((c, i) => response.cookies.set(`${STORAGE_KEY}.${i}`, c, opts))
  }
}

export async function updateSession(request: NextRequest) {
  const host            = request.headers.get('host')
  const supabaseResponse = NextResponse.next({ request })

  const raw = readRawSession(request)
  if (!raw) return { supabaseResponse, user: null }

  const claims = jwtClaims(raw.access_token)
  if (!claims) {
    clearSbCookies(supabaseResponse, request, host)
    return { supabaseResponse, user: null }
  }

  const now = Math.floor(Date.now() / 1000)

  // Token still valid — let the browser's autoRefreshToken handle the
  // proactive 90-second refresh window so we never race with it here.
  if ((claims.exp ?? 0) > now) {
    return { supabaseResponse, user: { id: claims.sub ?? '' } }
  }

  // Access token expired — refresh directly via the Supabase token endpoint.
  // No @supabase/ssr client = no _emitInitialSession IIFE = no race.
  try {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey:          SUPABASE_ANON,
          Authorization:  `Bearer ${SUPABASE_ANON}`,
        },
        body:   JSON.stringify({ refresh_token: raw.refresh_token }),
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!res.ok) {
      clearSbCookies(supabaseResponse, request, host)
      return { supabaseResponse, user: null }
    }

    const newSession = await res.json() as RawSession
    if (!newSession.expires_at && newSession.expires_in) {
      newSession.expires_at = now + newSession.expires_in
    }

    writeSession(supabaseResponse, newSession, host)

    const newClaims = jwtClaims(newSession.access_token)
    return { supabaseResponse, user: newClaims?.sub ? { id: newClaims.sub } : null }
  } catch {
    clearSbCookies(supabaseResponse, request, host)
    return { supabaseResponse, user: null }
  }
}
