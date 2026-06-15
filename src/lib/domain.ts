export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'nyasapoai.com'

/**
 * Cookie `Domain` attribute so the Supabase session cookie is shared across
 * the root domain and all tenant subdomains (e.g. nyasapoai.com and
 * acme.nyasapoai.com) — required so a session created on one host carries
 * over when redirecting to a tenant's subdomain. Returns undefined (host-only
 * cookie) for unrelated hosts (e.g. *.vercel.app preview deployments).
 */
export function cookieDomainForHost(host: string | null | undefined): string | undefined {
  if (!host) return undefined
  const hostname = host.split(':')[0]
  if (hostname === ROOT_DOMAIN || hostname.endsWith(`.${ROOT_DOMAIN}`)) return `.${ROOT_DOMAIN}`
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return '.localhost'
  return undefined
}

/** Build the URL for a tenant's subdomain, preserving the current protocol/port. */
export function tenantUrl(subdomain: string, path: string): string {
  if (typeof window === 'undefined') return path
  const { protocol, host } = window.location
  const port = host.includes(':') ? `:${host.split(':')[1]}` : ''
  const base = host === 'localhost' || host.endsWith('.localhost') || host.startsWith('localhost:')
    ? 'localhost'
    : ROOT_DOMAIN
  return `${protocol}//${subdomain}.${base}${port}${path}`
}
