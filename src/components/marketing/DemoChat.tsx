'use client'

import { useState } from 'react'
import { MessageSquare, FileText, AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const demos = [
  {
    tab: 'Payment milestones',
    question: 'What are the payment milestones for the Airport Hills Phase 2 contract?',
    answer: {
      intro: 'Based on Airport Hills Phase 2 Contract (v3.2), payment is structured across 5 milestones:',
      bullets: [
        'Foundation completion — 15% (GHS 2.4M) — Q2 2024',
        'Structural work — 35% (GHS 5.6M) — Q4 2024',
        'MEP installation — 25% (GHS 4.0M) — Q1 2025',
        'Fit-out & finishing — 20% (GHS 3.2M) — Q3 2025',
        'Final handover & snag — 5% (GHS 0.8M) — Q4 2025',
      ],
    },
    source: 'Airport_Hills_Ph2_Contract_v3.2.pdf',
    sourcePage: 'Page 14, §7.3 — Payment Schedule',
    risk: 'Late payment penalty clause active: 2% per month after 30-day grace period.',
    recommendation: null,
  },
  {
    tab: 'Site progress',
    question: 'What is the current completion status of Block C at Cantonments Ridge?',
    answer: {
      intro: 'As of the March 2026 site report, Block C at Cantonments Ridge is at 67% overall completion:',
      bullets: [
        'Structural frame — 100% complete',
        'MEP rough-in — 85% complete',
        'Plastering & screeding — 70% complete',
        'Doors, windows & ironmongery — 45% complete',
        'Finishes & tiling — 22% complete',
      ],
    },
    source: 'Cantonments_Ridge_SiteReport_Mar2026.pdf',
    sourcePage: 'Page 3, Section 4 — Block Progress Summary',
    risk: null,
    recommendation: 'At current pace, handover is projected for October 2026 — 6 weeks ahead of schedule.',
  },
  {
    tab: 'Outstanding invoices',
    question: 'Which Mensah & Sons invoices are still unpaid and what is our exposure?',
    answer: {
      intro: 'Mensah & Sons Contractors has 3 outstanding invoices across 2 active projects:',
      bullets: [
        'INV-2024-0341 — GHS 480,000 — Airport Hills (45 days overdue)',
        'INV-2024-0389 — GHS 215,000 — Airport Hills (12 days overdue)',
        'INV-2025-0017 — GHS 892,000 — East Ridge Villas (due in 8 days)',
      ],
    },
    source: 'Contractor_Invoices_Q1_2025.xlsx',
    sourcePage: 'Sheet: Outstanding · Rows 14, 19, 31',
    risk: 'Total exposure GHS 1.587M. INV-2024-0341 may trigger the contractual dispute clause if unpaid within 15 days.',
    recommendation: null,
  },
]

export default function DemoChat() {
  const [active, setActive] = useState(0)
  const demo = demos[active]

  return (
    <div className="mx-auto max-w-4xl">
      {/* Tab bar */}
      <div className="flex flex-wrap gap-2 mb-6">
        {demos.map((d, i) => (
          <button
            key={d.tab}
            onClick={() => setActive(i)}
            className={cn(
              'rounded-full px-4 py-2 text-xs font-semibold transition-all',
              active === i
                ? 'bg-gold text-navy shadow-lg shadow-gold/25'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-900'
            )}
          >
            {d.tab}
          </button>
        ))}
      </div>

      {/* Chat window */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-2xl shadow-black/10">
        {/* Browser chrome */}
        <div className="flex h-10 items-center gap-2 border-b border-gray-200 bg-gray-50 px-4">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/40" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-500/40" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-500/40" />
          <div className="ml-4 flex-1 rounded-md bg-gray-100 px-3 py-1 text-[11px] text-gray-400">
            knowledgeinnovations.nyasapoai.com/ask
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <MessageSquare className="h-3 w-3" />
            Ask AI
          </div>
        </div>

        <div className="p-6 space-y-5 min-h-[340px]">
          {/* User bubble */}
          <div className="flex justify-end">
            <div className="max-w-sm rounded-2xl rounded-tr-sm bg-brand px-4 py-3 text-sm text-white leading-relaxed">
              {demo.question}
            </div>
          </div>

          {/* AI bubble */}
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light border border-brand/20 mt-1">
              <span className="text-[10px] font-black text-brand">AI</span>
            </div>
            <div className="flex-1 space-y-3">
              <div className="rounded-2xl rounded-tl-sm border border-gray-200 bg-gray-50 px-5 py-4">
                <p className="text-sm text-gray-700 mb-3 leading-relaxed">{demo.answer.intro}</p>
                <ul className="space-y-2">
                  {demo.answer.bullets.map((b, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600 leading-relaxed">
                      <ChevronRight className="h-4 w-4 shrink-0 text-brand/50 mt-0.5" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Source citation */}
              <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-brand/60" />
                <div>
                  <span className="text-xs font-semibold text-gray-600">{demo.source}</span>
                  <span className="ml-2 text-[11px] text-gray-400">{demo.sourcePage}</span>
                </div>
              </div>

              {/* Risk flag */}
              {demo.risk && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
                  <p className="text-xs leading-relaxed text-amber-700">{demo.risk}</p>
                </div>
              )}

              {/* Recommendation */}
              {demo.recommendation && (
                <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                  <p className="text-xs leading-relaxed text-emerald-700">{demo.recommendation}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
