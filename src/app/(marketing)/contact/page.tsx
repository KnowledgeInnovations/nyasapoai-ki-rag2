import type { Metadata } from 'next'
import ContactForm from '@/components/marketing/ContactForm'

export const metadata: Metadata = { title: 'Contact' }

/**
 * `plan` tells us which call to action brought them here — the pricing page
 * links Enterprise to /contact?plan=enterprise — so an enterprise enquiry is
 * recognisable as one without reading the message.
 */
export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>
}) {
  const { plan } = await searchParams
  const enterprise = plan === 'enterprise'

  return (
    <div className="bg-paper px-6 py-24 font-editorial-sans md:px-8">
      <div className="animate-fade-up mx-auto max-w-xl">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
          {enterprise ? 'Enterprise' : 'Contact'}
        </span>
        <h1 className="font-editorial mt-3.5 text-4xl font-normal text-gray-900">
          {enterprise ? 'Talk to us about Enterprise' : 'Get in touch'}
        </h1>
        <p className="mt-3 text-gray-500">
          {enterprise
            ? 'Tell us about your deployment, security and data processing requirements — we reply within one business day.'
            : 'Questions, custom requirements, or partnership enquiries — we reply within one business day.'}
        </p>

        <ContactForm source={enterprise ? 'pricing_enterprise' : 'contact'} />
      </div>
    </div>
  )
}
