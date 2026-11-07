import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getPlanPrices, formatPrice, periodLabel } from '@/lib/planPrices'
import { PLANS, type Plan } from '@/lib/plans'

export const metadata: Metadata = {
  title: 'Pricing — Nyansa AI',
  description: 'Plans that grow with your organization — from small teams to enterprise-wide deployments.',
}

/**
 * What a plan actually includes, read from the limits that are enforced.
 *
 * These lines used to be hand-written next to the hand-written benefits, and
 * said things like "Higher document & storage limits" — which answers none of
 * the questions a buyer is asking, while the real figures sat in
 * src/lib/plans.ts being enforced against their account. A page that cannot
 * tell you how much storage you are buying is not a pricing page.
 *
 * Generated rather than retyped, so the number a customer is quoted and the
 * number their workspace is held to cannot drift apart. Changing a limit in
 * plans.ts changes this page in the same commit.
 */
function capacityOf(plan: Plan): string[] {
  const p = PLANS[plan]
  const gb = (bytes: number) => {
    const g = bytes / (1024 * 1024 * 1024)
    return g >= 1 ? `${Math.round(g)} GB` : `${Math.round(bytes / (1024 * 1024))} MB`
  }
  const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`
  const count = (v: number | null, one: string, many: string) =>
    v === null ? `Unlimited ${many}` : `${v.toLocaleString()} ${v === 1 ? one : many}`

  return [
    count(p.maxUsers, 'team member', 'team members'),
    p.maxSeniorUsers === null
      ? 'Unlimited senior administrators'
      : `${p.maxSeniorUsers} senior administrator${p.maxSeniorUsers === 1 ? '' : 's'}`,
    count(p.maxDocuments, 'document', 'documents'),
    p.maxStorageBytes === null ? 'Storage agreed in contract' : `${gb(p.maxStorageBytes)} of document storage`,
    p.maxFileBytes === null ? 'File size agreed in contract' : `${mb(p.maxFileBytes)} maximum file size`,
    p.includedQueriesPerMonth === null
      ? 'Unlimited questions'
      : `${p.includedQueriesPerMonth.toLocaleString()} AI questions a month`,
  ]
}

const tiers = [
  {
    n: '01',
    plan: 'starter' as Plan,
    name: 'Starter',
    tagline: 'For small teams getting started with document AI.',
    features: [
      'Ask AI across your uploaded documents',
      'Cited, source-linked answers',
      'Role-based access control',
      'Email support',
    ],
    cta: { label: 'Start free', href: '/auth/signup' },
    highlighted: false,
  },
  {
    n: '02',
    plan: 'professional' as Plan,
    name: 'Professional',
    tagline: 'For growing organizations with multiple teams and departments.',
    features: [
      'Everything in Starter',
      'Department dashboards & insights',
      'Senior permissions granted individually',
      'Priority support',
    ],
    cta: { label: 'Start free', href: '/auth/signup' },
    highlighted: true,
  },
  {
    n: '03',
    plan: 'enterprise' as Plan,
    name: 'Enterprise',
    tagline: 'For large organizations with custom security and deployment needs.',
    features: [
      'Everything in Professional',
      'Departments, custom roles and per-knowledge-base access',
      'Custom data processing agreements',
      'Dedicated onboarding & training',
      'On-premise / custom deployment options',
    ],
    cta: { label: 'Talk to us', href: '/contact?plan=enterprise' },
    highlighted: false,
  },
]

/**
 * Rendered per request, not prerendered.
 *
 * Without this Next treats the page as static — nothing in it reads cookies
 * or headers, so it was baked at build time and served from the CDN with
 * whatever prices existed then. A price set afterwards in /admin/tenants
 * would not have appeared here until the next deploy, while the admin panel
 * said "the pricing page shows these now". Confirmed on production as
 * X-Vercel-Cache: PRERENDER before this was added.
 *
 * The cost is one small query per visit. If this page ever takes real
 * traffic, `export const revalidate = 60` trades a minute of staleness for
 * a cached render; per-request is the right default while prices changing
 * immediately matters more than shaving a query.
 */
export const dynamic = 'force-dynamic'

export default async function PricingPage() {
  const prices = await getPlanPrices()

  return (
    <div className="bg-paper px-6 py-24 font-editorial-sans md:px-8">
      <div className="animate-fade-up mx-auto max-w-2xl text-center">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Pricing</span>
        <h1 className="font-editorial mt-3.5 text-4xl font-normal text-gray-900">Plans for every organization</h1>
        <p className="mt-4 text-gray-500">
          Every plan includes a private, secure workspace with cited AI answers across your documents.
          Contact us if you need help choosing.
        </p>
      </div>

      <div className="mx-auto mt-16 grid max-w-5xl divide-y divide-gray-200 border border-gray-200 bg-white md:grid-cols-3 md:divide-x md:divide-y-0">
        {tiers.map(tier => (
          <div
            key={tier.name}
            className={cn(
              'flex flex-col px-8 py-9',
              tier.highlighted && 'relative bg-brand-light'
            )}
          >
            {tier.highlighted && (
              <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-brand to-gold" />
            )}
            <div className="font-editorial mb-3.5 text-2xl italic text-brand">{tier.n}</div>
            <h2 className="text-lg font-semibold text-gray-900">{tier.name}</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">{tier.tagline}</p>

            {/* No published price says so, rather than showing a zero —
                which would be the one figure that is actively wrong. */}
            <div className="mt-5 border-t border-gray-200/70 pt-5">
              {formatPrice(prices[tier.plan]) ? (
                <>
                  <p className="font-editorial text-3xl font-normal text-gray-900">
                    {formatPrice(prices[tier.plan])}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {periodLabel(prices[tier.plan])}
                    {prices[tier.plan].unit ? ` · ${prices[tier.plan].unit}` : ''}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-editorial text-2xl font-normal text-gray-900">Talk to us</p>
                  <p className="mt-1 text-xs text-gray-500">Priced to your requirements</p>
                </>
              )}
            </div>

            <div className="mt-6">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                What you get
              </p>
              <ul className="mt-2.5 space-y-2">
                {capacityOf(tier.plan).map(c => (
                  <li key={c} className="flex items-baseline gap-2.5 text-sm font-medium text-gray-800">
                    <span className="font-editorial italic text-brand">—</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>

            <ul className="mt-5 flex-1 space-y-3 border-t border-gray-100 pt-5">
              {tier.features.map(f => (
                <li key={f} className="flex items-baseline gap-2.5 text-sm text-gray-600">
                  <span className="font-editorial italic text-brand">—</span>
                  {f}
                </li>
              ))}
            </ul>

            <Link
              href={tier.cta.href}
              className={cn(
                'mt-8 inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold transition',
                tier.highlighted
                  ? 'bg-brand text-white hover:bg-brand-dark'
                  : 'border border-gray-300 text-gray-900 hover:border-brand hover:text-brand'
              )}
            >
              {tier.cta.label} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-16 max-w-2xl border border-gray-200 bg-white p-9 text-center">
        <h2 className="font-editorial text-xl font-normal text-gray-900">Not sure which plan is right for you?</h2>
        <p className="mt-3 text-sm text-gray-500">
          We&apos;ll help you figure out the right fit based on your team size, document volume, and security requirements.
        </p>
        <a
          href="mailto:no-reply@nyansaai.com"
          className="mt-6 inline-flex items-center gap-2 bg-brand px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
        >
          Contact sales <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  )
}
