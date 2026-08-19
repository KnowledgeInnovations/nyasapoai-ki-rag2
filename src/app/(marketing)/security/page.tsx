import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'

export const metadata: Metadata = { title: 'Security' }

const features = [
  {
    n: '01',
    title: 'Tenant isolation',
    description: "Every organisation lives in a completely isolated data environment. Your documents are never mixed with another tenant's data.",
  },
  {
    n: '02',
    title: 'Encryption at rest & in transit',
    description: 'All data is encrypted at rest (AES-256) and in transit (TLS 1.3). Embeddings and document chunks are stored encrypted.',
  },
  {
    n: '03',
    title: 'Role-based access control',
    description: 'Senior, Middle, and Junior roles enforce what each user can see and do — at the database level, not just the UI.',
  },
  {
    n: '04',
    title: 'Audit logs',
    description: 'Every query, upload, and permission change is logged with a timestamp and user identity for compliance review.',
  },
]

export default function SecurityPage() {
  return (
    <div className="bg-paper px-6 py-24 font-editorial-sans md:px-8">
      <div className="animate-fade-up mx-auto max-w-2xl text-center">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Enterprise ready</span>
        <h1 className="font-editorial mt-3.5 text-4xl font-normal text-gray-900">Security you can trust</h1>
        <p className="mt-4 text-gray-500">
          Nyansa AI is built with enterprise security requirements as a first-class concern — not an afterthought.
        </p>
      </div>

      <div className="mx-auto mt-16 grid max-w-4xl divide-y divide-gray-200 border border-gray-200 bg-white sm:grid-cols-2 sm:divide-y-0 sm:divide-x">
        {features.map(f => (
          <div key={f.title} className="border-t-[3px] border-brand px-8 py-9">
            <div className="font-editorial mb-3.5 text-2xl italic text-brand">{f.n}</div>
            <h2 className="text-lg font-semibold text-gray-900">{f.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">{f.description}</p>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-16 max-w-2xl border border-gray-200 bg-white p-9 text-center">
        <h2 className="font-editorial text-xl font-normal text-gray-900">Have specific compliance requirements?</h2>
        <p className="mt-3 text-sm text-gray-500">
          We work with legal and compliance teams on custom data processing agreements, GDPR requirements, and on-premise deployment options.
        </p>
        <a
          href="mailto:security@nyansaai.com"
          className="mt-6 inline-flex items-center gap-2 bg-brand px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
        >
          Talk to our security team <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  )
}
