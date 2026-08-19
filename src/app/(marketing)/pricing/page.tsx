import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Pricing — Nyansa AI',
  description: 'Plans that grow with your organization — from small teams to enterprise-wide deployments.',
}

const tiers = [
  {
    n: '01',
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
    name: 'Professional',
    tagline: 'For growing organizations with multiple teams and departments.',
    features: [
      'Everything in Starter',
      'Department dashboards & insights',
      'Higher document & storage limits',
      'Priority support',
    ],
    cta: { label: 'Start free', href: '/auth/signup' },
    highlighted: true,
  },
  {
    n: '03',
    name: 'Enterprise',
    tagline: 'For large organizations with custom security and deployment needs.',
    features: [
      'Everything in Professional',
      'Custom data processing agreements',
      'Dedicated onboarding & training',
      'On-premise / custom deployment options',
    ],
    cta: { label: 'Talk to us', href: '/contact' },
    highlighted: false,
  },
]

export default function PricingPage() {
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

            <ul className="mt-6 flex-1 space-y-3">
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
          href="mailto:hello@nyansaai.com"
          className="mt-6 inline-flex items-center gap-2 bg-brand px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
        >
          Contact sales <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  )
}
