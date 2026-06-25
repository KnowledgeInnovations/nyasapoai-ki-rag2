import { NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'nyasapoai.com'

export async function proxy(request: NextRequest) {
  const url = request.nextUrl.clone()
  const hostname = request.headers.get('host') || ''

  // Strip port for local dev (localhost:3000 → localhost)
  const host = hostname.replace(`:${url.port}`, '')

  // Detect subdomain — e.g. "knowledgeinnovations" from knowledgeinnovations.nyasapoai.com
  // In dev use: knowledgeinnovations.localhost
  const subdomain = host.endsWith(`.${ROOT_DOMAIN}`)
    ? host.replace(`.${ROOT_DOMAIN}`, '')
    : host.endsWith('.localhost')
    ? host.replace('.localhost', '')
    : null

  const isAppSubdomain = subdomain && subdomain !== 'www'

  // Refresh Supabase auth session
  const { supabaseResponse, user } = await updateSession(request)

  // App subdomains (e.g. knowledge.nyasapoai.com) go straight to the workspace —
  // tenant is resolved server-side from the signed-in user's membership.
  if (isAppSubdomain) {
    const isMarketingRoute =
      url.pathname === '/' ||
      url.pathname.startsWith('/#') ||
      url.pathname === '/security' ||
      url.pathname === '/contact'

    // Protect app routes — redirect to login if not authenticated.
    // Marketing routes (landing page, security, contact) are public.
    // The Supabase Send Email Hook is called server-to-server with no user
    // session at all — it authenticates via its own signed-webhook check,
    // not a cookie, so it must bypass this redirect or every auth email
    // Supabase tries to send would fail.
    const isPublicWebhook = url.pathname === '/api/auth/send-email-hook'
    if (!user && !url.pathname.startsWith('/auth') && !isMarketingRoute && !isPublicWebhook) {
      url.pathname = '/auth/login'
      url.searchParams.set('tenant', subdomain)
      return NextResponse.redirect(url)
    }

    // Land signed-in visitors on the ask page instead of the marketing homepage
    if (user && url.pathname === '/') {
      url.pathname = '/ask'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
