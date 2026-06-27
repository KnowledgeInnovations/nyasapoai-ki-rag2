export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'nyansaai.com'

/**
 * Cookie `Domain` attribute so the Supabase session cookie is shared across
 * the root domain and all tenant subdomains (e.g. nyansaai.com and
 * acme.nyansaai.com) — required so a session created on one host carries
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

/** Build the URL for a tenant's subdomain, given a host (e.g. from a `Host` header). */
export function tenantUrlForHost(subdomain: string, path: string, host: string | null | undefined): string {
  const hostname = (host ?? '').split(':')[0]
  const port = host?.includes(':') ? `:${host.split(':')[1]}` : ''
  const isLocal = hostname === 'localhost' || hostname.endsWith('.localhost')
  const protocol = isLocal ? 'http:' : 'https:'
  const base = isLocal ? 'localhost' : ROOT_DOMAIN
  return `${protocol}//${subdomain}.${base}${port}${path}`
}

/** Build a URL on the root domain (no tenant subdomain), given a host. */
export function rootUrlForHost(path: string, host: string | null | undefined): string {
  const hostname = (host ?? '').split(':')[0]
  const port = host?.includes(':') ? `:${host.split(':')[1]}` : ''
  const isLocal = hostname === 'localhost' || hostname.endsWith('.localhost')
  const protocol = isLocal ? 'http:' : 'https:'
  const base = isLocal ? 'localhost' : ROOT_DOMAIN
  return `${protocol}//${base}${port}${path}`
}

/** Build the URL for a tenant's subdomain, preserving the current protocol/port. */
export function tenantUrl(subdomain: string, path: string): string {
  if (typeof window === 'undefined') return path
  return tenantUrlForHost(subdomain, path, window.location.host)
}

/**
 * Extract the tenant subdomain from a host, or null if the host is the root
 * domain, `www`, or unrelated (e.g. a *.vercel.app preview deployment).
 */
export function subdomainFromHost(host: string | null | undefined): string | null {
  if (!host) return null
  const hostname = host.split(':')[0]
  let sub: string | null = null
  if (hostname.endsWith(`.${ROOT_DOMAIN}`)) sub = hostname.slice(0, -(ROOT_DOMAIN.length + 1))
  else if (hostname.endsWith('.localhost')) sub = hostname.slice(0, -'.localhost'.length)
  return sub && sub !== 'www' ? sub : null
}
