// Fallback persona blurb for tenants that haven't set tenants.description yet.
export const DEFAULT_TENANT_DESCRIPTION = 'an organization using NyasapoAI to manage its documents and insights'

// Subdomains that are part of the platform itself and can never be claimed
// by a tenant (root domain, auth routes, common infra hostnames, etc.)
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'admin', 'auth', 'mail', 'email', 'ftp', 'support',
  'help', 'status', 'docs', 'blog', 'static', 'assets', 'cdn', 'dashboard',
  'login', 'signup', 'pricing', 'security', 'contact', 'about', 'nyasapoai',
  'nyansapoai', 'test', 'staging', 'dev', 'localhost',
])

const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/

/** Slugify a workspace name into a candidate subdomain, e.g. "Acme Corp" -> "acme-corp". */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

/** Validate a subdomain's format and reserved-word status. Returns an error message, or null if valid. */
export function validateSubdomainFormat(subdomain: string): string | null {
  if (!SUBDOMAIN_REGEX.test(subdomain)) {
    return 'Subdomain must be 3-63 characters, lowercase letters, numbers, and hyphens only (no leading/trailing hyphen).'
  }
  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    return 'This subdomain is reserved. Please choose another.'
  }
  return null
}
