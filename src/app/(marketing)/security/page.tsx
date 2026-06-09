import type { Metadata } from 'next'
import { ShieldCheck, Lock, Eye, FileCheck } from 'lucide-react'

export const metadata: Metadata = { title: 'Security' }

const features = [
  {
    icon: ShieldCheck,
    title: 'Tenant isolation',
    description: "Every organisation lives in a completely isolated data environment. Your documents are never mixed with another tenant's data.",
  },
  {
    icon: Lock,
    title: 'Encryption at rest & in transit',
    description: 'All data is encrypted at rest (AES-256) and in transit (TLS 1.3). Embeddings and document chunks are stored encrypted.',
  },
  {
    icon: Eye,
    title: 'Role-based access control',
    description: 'Senior, Middle, and Junior roles enforce what each user can see and do — at the database level, not just the UI.',
  },
  {
    icon: FileCheck,
    title: 'Audit logs',
    description: 'Every query, upload, and permission change is logged with a timestamp and user identity for compliance review.',
  },
]

export default function SecurityPage() {
  return (
    <div className="px-6 py-24">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="text-4xl font-extrabold text-gray-900">Security you can trust</h1>
        <p className="mt-4 text-gray-500">
          NyasapoAI is built with enterprise security requirements as a first-class concern — not an afterthought.
        </p>
      </div>

      <div className="mx-auto mt-16 grid max-w-4xl gap-8 md:grid-cols-2">
        {features.map((f) => (
          <div key={f.title} className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-light text-brand">
              <f.icon className="h-6 w-6" />
            </div>
            <h2 className="mt-5 text-lg font-semibold text-gray-900">{f.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">{f.description}</p>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-16 max-w-3xl rounded-2xl bg-brand-light p-8 text-center">
        <h2 className="text-xl font-bold text-gray-900">Have specific compliance requirements?</h2>
        <p className="mt-3 text-sm text-gray-600">
          We work with legal and compliance teams on custom data processing agreements, GDPR requirements, and on-premise deployment options.
        </p>
        <a
          href="mailto:security@nyasapoai.com"
          className="mt-6 inline-block rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Talk to our security team
        </a>
      </div>
    </div>
  )
}
