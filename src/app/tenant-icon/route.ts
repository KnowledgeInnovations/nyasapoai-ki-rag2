import { NextRequest, NextResponse } from 'next/server'
import { getTenantLogoPath } from '@/lib/supabase/server'
import { subdomainFromHost } from '@/lib/domain'
import { publicUrlFor } from '@/lib/tenantLogo'

// Per-tenant browser icon. The root layout points <link rel="icon"> here as a
// static path, so pages themselves stay statically renderable — the per-host
// resolution happens when the browser fetches the icon, not when a page renders.
//
// Redirects rather than streaming bytes: the underlying image URL is distinct
// per tenant, so browsers and CDNs cache the actual image normally and only
// this tiny hop is per-request.
export const dynamic = 'force-dynamic'

const DEFAULT_ICON = '/nyansaai.jpeg'

export async function GET(request: NextRequest) {
  const host = request.headers.get('host')
  const subdomain = subdomainFromHost(host)

  let target = DEFAULT_ICON
  if (subdomain) {
    const logoPath = await getTenantLogoPath(subdomain)
    if (logoPath && process.env.NEXT_PUBLIC_SUPABASE_URL) target = publicUrlFor(logoPath)
  }

  const res = NextResponse.redirect(new URL(target, request.url), 307)
  // `private` keeps shared caches out of it: the URL is the same for every
  // tenant and only the Host distinguishes them, so a shared cache could
  // otherwise hand one tenant's logo to another. Vary: Host says the same
  // thing to anything that does cache.
  res.headers.set('Cache-Control', 'private, max-age=300')
  res.headers.set('Vary', 'Host')
  return res
}
