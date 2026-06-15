import type { Metadata } from 'next'
import Link from 'next/link'
import { Check, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Pricing — NyasapoAI',
  description: 'Plans that grow with your organization — from small teams to enterprise-wide deployments.',
}

const tiers = [
  {
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
    <div className="px-6 py-24">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="text-4xl font-extrabold text-gray-900">Plans for every organization</h1>
        <p className="mt-4 text-gray-500">
          Every plan includes a private, secure workspace with cited AI answers across your documents.
          Contact us if you need help choosing.
        </p>
      </div>

      <div className="mx-auto mt-16 grid max-w-5xl gap-8 md:grid-cols-3">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={cn(
              'flex flex-col rounded-2xl border p-8 shadow-sm',
              tier.highlighted
                ? 'border-brand bg-brand-light shadow-lg shadow-brand/10'
                : 'border-gray-200 bg-white'
            )}
          >
            <h2 className="text-lg font-semibold text-gray-900">{tier.name}</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">{tier.tagline}</p>

            <ul className="mt-6 flex-1 space-y-3">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-gray-600">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  {f}
                </li>
              ))}
            </ul>

            <Link
              href={tier.cta.href}
              className={cn(
                'mt-8 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition',
                tier.highlighted
                  ? 'bg-brand text-white hover:bg-brand-dark'
                  : 'border border-brand/25 bg-brand-light text-brand hover:bg-brand hover:text-white hover:border-brand'
              )}
            >
              {tier.cta.label} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-16 max-w-3xl rounded-2xl bg-brand-light p-8 text-center">
        <h2 className="text-xl font-bold text-gray-900">Not sure which plan is right for you?</h2>
        <p className="mt-3 text-sm text-gray-600">
          We&apos;ll help you figure out the right fit based on your team size, document volume, and security requirements.
        </p>
        <a
          href="mailto:hello@nyasapoai.com"
          className="mt-6 inline-block rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Contact sales
        </a>
      </div>
    </div>
  )
}
