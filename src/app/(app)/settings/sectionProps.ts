import { getUser, getMembership, getTenant, getTenantLogoPath } from '@/lib/supabase/server'
import { publicUrlFor } from '@/lib/tenantLogo'

// Shared by the Profile, Security and Workspace routes, which render the same
// client component with a different `section`. All served from cache — no
// extra network calls beyond what the layout already did.
export async function settingsSectionProps() {
  const [user, membership] = await Promise.all([getUser(), getMembership()])
  const tenant = membership ? await getTenant(membership.tenant_id) : null
  // Tolerates migration 033 not having run yet — resolves to null, and the
  // workspace falls back to the default icon.
  const logoPath = tenant ? await getTenantLogoPath(tenant.subdomain) : null

  return {
    email:            user?.email ?? '',
    name:             user?.user_metadata?.name ?? '',
    role:             membership?.role ?? 'junior',
    emailDomains:     tenant?.email_domains ?? [],
    isPlatformTenant: tenant?.is_platform ?? false,
    logoUrl:          logoPath ? publicUrlFor(logoPath) : null,
  }
}
