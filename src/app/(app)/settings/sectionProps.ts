import { getUser, getMembership, getTenant, getTenantLogoPath, metaString } from '@/lib/supabase/server'
import { publicUrlFor } from '@/lib/tenantLogo'
import { getPlanPrices, PLAN_ORDER } from '@/lib/planPrices'

// Shared by the Profile, Security and Workspace routes, which render the same
// client component with a different `section`. All served from cache — no
// extra network calls beyond what the layout already did.
export async function settingsSectionProps() {
  const [user, membership] = await Promise.all([getUser(), getMembership()])
  const tenant = membership ? await getTenant(membership.tenant_id) : null
  // Tolerates migration 033 not having run yet — resolves to null, and the
  // workspace falls back to the default icon.
  const logoPath = tenant ? await getTenantLogoPath(tenant.subdomain) : null

  const prices = await getPlanPrices()

  return {
    plan:             tenant?.plan ?? 'starter',
    prices:           PLAN_ORDER.map(p => prices[p]),
    // Null when the workspace is not on paid billing — see migration 047.
    // Tolerates 047 not having run: the column is absent, so it reads as
    // undefined and the panel simply says nothing about payment.
    paidUntil:        (tenant as { paid_until?: string | null } | null)?.paid_until ?? null,
    paymentChannel:   (tenant as { paystack_channel?: string | null } | null)?.paystack_channel ?? null,
    email:            user?.email ?? '',
    name:             metaString(user, 'name') ?? '',
    role:             membership?.role ?? 'junior',
    emailDomains:     tenant?.email_domains ?? [],
    isPlatformTenant: tenant?.is_platform ?? false,
    logoUrl:          logoPath ? publicUrlFor(logoPath) : null,
  }
}
