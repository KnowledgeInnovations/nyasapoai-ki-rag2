import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Sparkles, FileText, MessageSquare, ShieldCheck,
  Zap, BookOpen, ArrowRight, CheckCircle2,
} from 'lucide-react'
import DemoChat from '@/components/marketing/DemoChat'
import FAQ from '@/components/marketing/FAQ'

// Statically generated — revalidated every 24 hours
export const revalidate = 86400

export const metadata: Metadata = {
  title: 'NyasapoAI — Enterprise Document Intelligence',
  description: 'Turn your organization\'s documents into a decision-ready knowledge base. Ask questions in plain English and get cited, trustworthy answers in seconds.',
}

const features = [
  {
    icon: MessageSquare,
    title: 'Ask Anything',
    body: 'Ask questions in plain English across thousands of engagement files, proposals, and research reports. No search operators, no training needed.',
  },
  {
    icon: BookOpen,
    title: 'Cited Answers',
    body: 'Every response links directly to the source document and page number. Zero hallucinations — full accountability at every level.',
  },
  {
    icon: ShieldCheck,
    title: 'Enterprise Security',
    body: 'Role-based access control built in. Executives, managers, and teams see only what they are cleared for. Data never leaves your workspace.',
  },
]

const steps = [
  { n: '01', title: 'Upload your documents', body: 'Add PDFs, engagement reports, proposals, and spreadsheets. Drag-and-drop or upload in bulk. We handle extraction automatically.' },
  { n: '02', title: 'Ask in plain English', body: 'Type any business question naturally. Our AI searches across all your documents simultaneously in milliseconds.' },
  { n: '03', title: 'Get cited answers', body: 'Receive a precise answer with source citations, identified risks, and actionable recommendations you can act on immediately.' },
]

const stats = [
  { value: '1.2M+', label: 'Pages indexed' },
  { value: '< 2s',  label: 'Response time' },
  { value: '100%',  label: 'Cited answers' },
  { value: '24 / 7', label: 'Always available' },
]

const trusted = [
  'SOC 2-ready architecture',
  'End-to-end encryption',
  'Role-based access control',
  'Data isolation per tenant',
  'Cited answers — no hallucinations',
]

const exampleQueries = [
  'What were the key findings from the AI readiness assessment for our banking client?',
  'Show me all engagement contracts expiring in the next 90 days',
  'What does the digital transformation roadmap recommend for Q3?',
  'Summarise the FinTech compliance review submitted last month',
  'Which project deliverables are behind schedule this quarter?',
  'What risks were flagged in the latest cybersecurity audit?',
  'List all proposals submitted above GHS 50,000 this year',
  'What feedback came out of the AI training cohort in March?',
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-gray-900 overflow-x-hidden">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative flex min-h-screen items-center pt-16">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-1/3 right-1/4 h-96 w-96 rounded-full bg-gold/10 blur-3xl" />
          <div className="absolute bottom-1/3 left-1/4 h-72 w-72 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
        </div>

        <div className="relative mx-auto w-full max-w-7xl px-6 pb-20 pt-[22px] md:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="max-w-xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand-light px-4 py-1.5 text-xs font-semibold text-brand">
                <Sparkles className="h-3.5 w-3.5" />
                Enterprise RAG-based decision intelligence
              </div>

              <h1 className="text-5xl font-extrabold leading-[1.1] tracking-tight text-gray-900 xl:text-6xl">
                Every Document.
                <br />Every Decision.
                <br />
                <span className="bg-gradient-to-r from-brand to-gold bg-clip-text text-transparent">
                  Intelligently Answered.
                </span>
              </h1>

              <p className="mt-6 text-lg leading-relaxed text-gray-500">
                Give your team a private AI workspace that turns your documents — contracts,
                reports, proposals, policies — into instant, cited answers. Get started in
                minutes with your own secure subdomain.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/auth/signup"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-brand/25 transition hover:bg-brand-dark">
                  Start free <ArrowRight className="h-4 w-4" />
                </Link>
                <a href="#demo"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-6 py-3.5 text-sm font-semibold text-gray-600 transition hover:border-gray-300 hover:text-gray-900">
                  See it in action
                </a>
              </div>

              <div className="mt-10 flex flex-wrap gap-5">
                {[
                  { icon: ShieldCheck, text: 'Bank-grade encryption' },
                  { icon: FileText,    text: 'Always cited' },
                  { icon: Zap,         text: 'Sub-2s responses' },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Icon className="h-3.5 w-3.5 text-brand/60" />{text}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Workspace preview ────────────────────────────── */}
            <div className="relative hidden lg:flex items-center justify-center">
              {/* Glow behind card */}
              <div className="absolute inset-0 -z-10 scale-110 rounded-3xl bg-gold/10 blur-3xl" />

              <div className="relative flex w-full flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl shadow-black/10"
                style={{ height: 520 }}>
                {/* Top badge */}
                <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />
                  <span className="text-xs font-semibold text-brand">yourcompany.nyasapoai.com</span>
                </div>

                {/* Mock conversation preview */}
                <div className="flex flex-1 flex-col justify-end gap-4 p-6">
                  <div className="self-end max-w-[80%] rounded-2xl rounded-br-md border border-brand/20 bg-brand-light px-4 py-3 text-sm text-brand">
                    What were the key risks flagged in the latest AI readiness assessment?
                  </div>
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-600">
                    The assessment flagged three risks: data governance gaps, limited model monitoring, and unclear ownership of AI outputs.
                    <span className="mt-2 block text-xs font-semibold text-brand">Source: AI_Readiness_Assessment_v3.pdf · p. 12</span>
                  </div>
                </div>

                {/* Bottom info card */}
                <div className="m-5 mt-0 rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-base font-bold leading-tight text-gray-900">Engagement intelligence</p>
                      <p className="mt-0.5 text-xs text-gray-500">Every report, proposal &amp; deliverable — searchable in seconds</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-black leading-none text-brand">100%</p>
                      <p className="mt-0.5 text-[11px] text-gray-400">Cited</p>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full rounded-full bg-gradient-to-r from-brand to-gold" style={{ width: '100%' }} />
                  </div>
                </div>
              </div>

              {/* Floating stat chips */}
              <div className="absolute -right-4 top-16 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-xl shadow-black/5">
                <p className="text-xs text-gray-400">Pages indexed</p>
                <p className="text-xl font-black text-brand">1.2M+</p>
              </div>
              <div className="absolute -left-4 bottom-28 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-xl shadow-black/5">
                <p className="text-xs text-gray-400">Response time</p>
                <p className="text-xl font-black text-gray-900">&lt; 2s</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats strip ──────────────────────────────────────── */}
      <div className="border-y border-gray-200 bg-gray-50">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid grid-cols-2 divide-x divide-gray-200 md:grid-cols-4">
            {stats.map(s => (
              <div key={s.value} className="py-8 text-center">
                <div className="text-3xl font-black text-brand">{s.value}</div>
                <div className="mt-1 text-sm text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Live Demo ─────────────────────────────────────────── */}
      <section id="demo" className="px-6 py-24 md:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-brand">See it in action</span>
            <h2 className="mt-4 text-4xl font-extrabold text-gray-900">Real questions. Real documents.</h2>
            <p className="mx-auto mt-4 max-w-lg text-gray-500">
              Click any tab below to see how NyasapoAI answers real questions across contracts, site reports, and financial records.
            </p>
          </div>
          <DemoChat />
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────── */}
      <section id="features" className="px-6 py-24 bg-gray-50 md:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-14 text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-brand">
              Why teams choose NyasapoAI
            </span>
            <h2 className="mt-4 text-4xl font-extrabold text-gray-900">
              Intelligence built for modern organizations
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-gray-500">
              From contracts to board briefings — your documents become a searchable, answerable knowledge base your whole team can rely on.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {features.map(f => (
              <div key={f.title}
                className="group rounded-2xl border border-gray-200 bg-white p-8 transition-all duration-200 hover:border-brand/30 hover:shadow-xl hover:shadow-brand/5">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-brand/20 bg-brand-light">
                  <f.icon className="h-6 w-6 text-brand" />
                </div>
                <h3 className="mb-3 text-lg font-bold text-gray-900">{f.title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Example Queries ──────────────────────────────────── */}
      <section className="px-6 py-24 md:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-brand">What can you ask?</span>
          <h2 className="mt-4 text-4xl font-extrabold text-gray-900">Your team already has these questions</h2>
          <p className="mx-auto mt-4 max-w-lg text-gray-500">
            Any question you would normally spend hours chasing down — answered in under 2 seconds, with the source document cited.
          </p>
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            {exampleQueries.map(q => (
              <Link key={q} href="/auth/login"
                className="rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-600 transition hover:border-brand/30 hover:bg-brand-light hover:text-brand">
                {q}
              </Link>
            ))}
          </div>
          <Link href="/auth/signup"
            className="mt-10 inline-flex items-center gap-2 rounded-xl bg-brand-light border border-brand/20 px-6 py-3 text-sm font-bold text-brand transition hover:bg-brand hover:text-white">
            Start asking your own questions <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section id="how-it-works" className="px-6 py-24 bg-gray-50 md:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-14 text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-brand">Simple by design</span>
            <h2 className="mt-4 text-4xl font-extrabold text-gray-900">From upload to insight in 3 steps</h2>
          </div>

          <div className="space-y-6">
            {steps.map(s => (
              <div key={s.n}
                className="flex gap-6 rounded-2xl border border-gray-200 bg-white p-7 transition hover:border-brand/20 hover:shadow-md">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-brand/20 bg-brand-light">
                  <span className="text-base font-black text-brand">{s.n}</span>
                </div>
                <div className="pt-1">
                  <h3 className="text-lg font-bold mb-2 text-gray-900">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-gray-500">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trust & Security ─────────────────────────────────── */}
      <section className="px-6 py-20 md:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-brand">Enterprise ready</span>
          <h2 className="mt-4 text-3xl font-extrabold text-gray-900">Security you can trust</h2>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            {trusted.map(t => (
              <div key={t} className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600">
                <CheckCircle2 className="h-4 w-4 text-brand/60" />{t}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 bg-gray-50 md:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-14 text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-brand">Common questions</span>
            <h2 className="mt-4 text-4xl font-extrabold text-gray-900">Everything you need to know</h2>
            <p className="mx-auto mt-4 max-w-md text-gray-500">
              Still have questions? Reach out via the <Link href="/contact" className="text-brand hover:underline">contact page</Link>.
            </p>
          </div>
          <FAQ />
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="px-6 py-20 md:px-8">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-3xl border border-brand/15 bg-gradient-to-br from-brand-light to-white p-12 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-brand mb-4">Your workspace is one click away</p>
            <h2 className="text-4xl font-extrabold leading-tight text-gray-900">
              Stop searching.<br />Start knowing.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-gray-500">
              Every document. Every answer. Every source citation. Waiting for you right now.
            </p>
            <Link href="/auth/signup"
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-brand px-8 py-4 text-base font-bold text-white shadow-xl shadow-brand/25 transition hover:bg-brand-dark">
              Create your workspace <ArrowRight className="h-5 w-5" />
            </Link>
            <p className="mt-5 text-xs text-gray-400">
              No setup. No training. Ask your first question in under 2 minutes.
            </p>
          </div>
        </div>
      </section>

    </div>
  )
}
