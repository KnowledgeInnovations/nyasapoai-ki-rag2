import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'
import DemoChat from '@/components/marketing/DemoChat'
import FAQ from '@/components/marketing/FAQ'

// Statically generated — revalidated every 24 hours
export const revalidate = 86400

export const metadata: Metadata = {
  title: 'Nyansa AI — Enterprise Document Intelligence',
  description: 'Turn your organization\'s documents into a decision-ready knowledge base. Ask questions in plain English and get cited, trustworthy answers in seconds.',
}

const features = [
  {
    n: '01',
    title: 'Ask anything',
    body: 'Ask questions in plain English across thousands of engagement files, proposals, and research reports. No search operators, no training needed.',
  },
  {
    n: '02',
    title: 'Cited answers',
    body: 'Every response links directly to the source document and page number. Verify anything in seconds — full accountability at every level.',
  },
  {
    n: '03',
    title: 'Enterprise security',
    body: 'Role-based access control built in. Executives, managers, and teams see only what they are cleared for. Data never leaves your workspace.',
  },
]

const steps = [
  { n: '01', title: 'Upload your documents', body: 'Add PDFs, engagement reports, proposals, and spreadsheets. Drag-and-drop or bulk upload — extraction is automatic.' },
  { n: '02', title: 'Ask in plain English', body: 'Type any business question naturally. Nyansa AI searches across all your documents at once.' },
  { n: '03', title: 'Get a cited answer', body: 'Receive a precise answer with source citations you can act on immediately.' },
]

const proofPoints = [
  'Every answer cited to page and paragraph',
  'Isolated, encrypted workspace per organization',
  'Role-based access built in, not bolted on',
]

const trust = [
  'AES-256 encryption in transit and at rest',
  'Dedicated, isolated workspace per tenant',
  'Role-based access control at the document level',
  'Every answer grounded in a citation — nothing guessed',
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-paper text-gray-900 overflow-x-hidden font-editorial-sans">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="mx-auto grid max-w-7xl items-center gap-14 px-6 pb-16 pt-24 md:grid-cols-2 md:px-8 md:pt-28">
        <div>
          <div className="animate-fade-up mb-6 inline-block border-b border-brand pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand" style={{ animationDelay: '0.05s' }}>
            Document intelligence, institutional grade
          </div>

          <h1 className="animate-fade-up font-editorial max-w-xl text-[52px] font-normal leading-[1.14] text-gray-900" style={{ animationDelay: '0.15s' }}>
            Every question your documents can already answer —{' '}
            <span className="italic text-brand-dark">answered in seconds.</span>
          </h1>

          <p className="animate-fade-up mt-6 max-w-lg text-base leading-relaxed text-gray-500" style={{ animationDelay: '0.28s' }}>
            Nyansa AI reads your contracts, reports and filings, and answers plain-English
            questions with a citation your team can verify — page, paragraph and source,
            every time.
          </p>

          <div className="animate-fade-up mt-8 flex flex-col gap-4 sm:flex-row sm:items-center" style={{ animationDelay: '0.4s' }}>
            <Link href="/auth/signup"
              className="inline-flex items-center justify-center gap-2 bg-brand px-7 py-3.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-brand-dark hover:shadow-xl hover:shadow-brand/25">
              Request a workspace <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#demo" className="border-b border-gray-900 pb-0.5 text-sm text-gray-900 transition hover:border-brand hover:text-brand">
              Watch a 90-second walkthrough
            </a>
          </div>

          <div className="animate-fade-up mt-14 border-t border-gray-200 pt-6" style={{ animationDelay: '0.55s' }}>
            <div className="mb-3 text-[11px] uppercase tracking-[0.08em] text-gray-500">Trusted by teams at</div>
            <div className="flex flex-wrap gap-7 font-editorial text-sm italic text-gray-500">
              <span>[Client wordmark]</span><span>[Client wordmark]</span><span>[Client wordmark]</span>
            </div>
          </div>
        </div>

        {/* Photo + product-preview composition */}
        <div className="animate-fade-up relative hidden h-[560px] md:block" style={{ animationDelay: '0.3s' }}>
          <div className="animate-float absolute left-2 top-0 h-[492px] w-[380px] overflow-hidden border border-gray-200 shadow-[0_30px_60px_-24px_rgba(20,20,20,0.3)]">
            <Image
              src="/images/hero-desk.jpg"
              alt="A Nyansa AI customer at their desk, smiling after getting a cited answer"
              width={620} height={800}
              className="h-full w-full object-cover"
              priority
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand/15 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-brand to-gold" />
          </div>

          <div className="animate-spark absolute left-[318px] top-[104px] z-10">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M12 1 L14.4 9.6 L23 12 L14.4 14.4 L12 23 L9.6 14.4 L1 12 L9.6 9.6 Z" className="fill-gold" />
            </svg>
          </div>

          <div className="animate-float absolute bottom-4 right-0 z-10 w-[320px] border border-gray-200 bg-white shadow-[0_24px_60px_-20px_rgba(20,20,20,0.22)]" style={{ animationDelay: '1.2s' }}>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5 text-[11.5px] text-gray-600">
              <span>yourcompany.nyansaai.com</span>
              <span className="text-brand">Workspace</span>
            </div>
            <div className="px-5 pb-2 pt-5">
              <div className="mb-4 text-[12.5px] text-gray-600">
                &ldquo;What termination clauses apply to our Q3 vendor contracts?&rdquo;
              </div>
              <div className="border-l-2 border-brand pl-3.5 text-[12.5px] leading-relaxed text-gray-900">
                Three vendor contracts include a 60-day termination-for-convenience
                clause; two require 90 days&rsquo; written notice.
              </div>
              <div className="mt-3.5 flex flex-col gap-1.5">
                <div className="w-fit border border-brand/20 bg-brand-light px-2.5 py-1.5 text-[10.5px] text-brand">
                  Vendor_Agreement_Halcyon.pdf — p.4, §12.2
                </div>
              </div>
            </div>
            <div className="border-t border-gray-100 px-5 py-4 text-[10.5px] text-gray-600">
              Role-based access · isolated per workspace
            </div>
          </div>
        </div>
      </section>

      {/* ── Proof strip ──────────────────────────────────────── */}
      <div className="border-y border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-center gap-10 px-6 py-7 md:px-8">
          {proofPoints.map((p, i) => (
            <div key={p} className="flex items-center gap-2.5 text-[13.5px] text-gray-600">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${i === 1 ? 'bg-gold-dark' : 'bg-brand'}`} />
              {p}
            </div>
          ))}
        </div>
      </div>

      {/* ── Live Demo ─────────────────────────────────────────── */}
      <section id="demo" className="px-6 py-24 md:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">See it in action</span>
          <h2 className="font-editorial mt-3.5 text-4xl font-normal text-gray-900">Real questions. Real documents.</h2>
          <p className="mx-auto mt-4 max-w-lg text-gray-500">
            Click a document type to see how Nyansa AI answers real questions across
            contracts, site reports, and financial records.
          </p>
        </div>
        <div className="mt-11">
          <DemoChat />
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────── */}
      <section id="features" className="border-y border-gray-200 bg-white px-6 py-24 md:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
              Why teams choose Nyansa AI
            </span>
            <h2 className="font-editorial mt-3.5 text-4xl font-normal text-gray-900">
              Intelligence built for modern organizations
            </h2>
          </div>

          <div className="grid divide-y divide-gray-200 md:grid-cols-3 md:divide-x md:divide-y-0">
            {features.map(f => (
              <div key={f.title} className="group border-t-[3px] border-brand px-7 py-8 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-black/5">
                <div className="font-editorial mb-3.5 text-2xl italic text-brand">{f.n}</div>
                <h3 className="mb-2.5 text-lg font-semibold text-gray-900">{f.title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 py-24 md:px-8">
        <div className="mb-14 text-center">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Simple by design</span>
          <h2 className="font-editorial mt-3.5 text-4xl font-normal text-gray-900">From upload to insight in three steps</h2>
        </div>
        <div>
          {steps.map((s, i) => (
            <div key={s.n} className={`flex gap-7 py-6 ${i < steps.length - 1 ? 'border-b border-gray-200' : ''}`}>
              <div className="font-editorial w-14 shrink-0 text-3xl italic text-brand">{s.n}</div>
              <div>
                <h3 className="mb-1.5 text-[17px] font-semibold text-gray-900">{s.title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Trust & Security ─────────────────────────────────── */}
      <section className="border-y border-gray-200 bg-white px-6 py-20 md:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Enterprise ready</span>
          <h2 className="font-editorial mt-3.5 text-[30px] font-normal text-gray-900">Security your compliance team will approve</h2>
          <div className="mt-10 text-left">
            {trust.map((t, i) => (
              <div key={t} className={`flex items-baseline gap-3.5 py-4 ${i < trust.length - 1 ? 'border-b border-gray-200' : ''}`}>
                <span className="font-editorial italic text-brand">—</span>
                <span className="text-[14.5px] text-gray-900">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 py-24 md:px-8">
        <div className="mb-14 text-center">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Common questions</span>
          <h2 className="font-editorial mt-3.5 text-4xl font-normal text-gray-900">Everything you need to know</h2>
          <p className="mx-auto mt-4 max-w-md text-gray-500">
            Still have questions? Reach out via the <Link href="/contact" className="text-brand hover:underline">contact page</Link>.
          </p>
        </div>
        <FAQ />
      </section>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-brand px-6 py-22 text-center md:px-8">
        <div className="animate-spark absolute right-28 top-10 h-2 w-2 rounded-full bg-gold" />
        <div className="animate-spark absolute bottom-14 left-40 h-1.5 w-1.5 rounded-full bg-gold" style={{ animationDelay: '1s' }} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">Your workspace is one click away</span>
        <h2 className="font-editorial mt-4 text-4xl font-normal text-white">Stop searching. Start knowing.</h2>
        <p className="mx-auto mt-4 max-w-md text-[14.5px] leading-relaxed text-white/75">
          Every document. Every answer. Every source cited. Waiting for you right now.
        </p>
        <Link href="/auth/signup"
          className="mt-8 inline-flex items-center gap-2 bg-white px-7 py-3.5 text-sm font-bold text-brand-dark transition hover:-translate-y-0.5 hover:shadow-xl">
          Create your workspace <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

    </div>
  )
}
