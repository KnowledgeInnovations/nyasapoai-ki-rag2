'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, Tag } from 'lucide-react'
import { PLANS } from '@/lib/plans'
import type { PlanPrice } from '@/lib/planPrices'

/**
 * Setting what each plan costs. Platform admins only — these are Nyansa AI's
 * prices, not a workspace's.
 *
 * An empty amount is a deliberate state, not a missing one: the pricing page
 * then says to get in touch instead of publishing a figure. Leaving it blank
 * is how Enterprise stays "talk to us" while still being self-serve.
 */
export default function PlanPricesClient({ initial }: { initial: PlanPrice[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  function update(plan: string, patch: Partial<PlanPrice>) {
    setRows(prev => prev.map(r => r.plan === plan ? { ...r, ...patch } : r))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch('/api/plan-prices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prices: rows }),
      })
      const data = await res.json() as { prices?: PlanPrice[]; error?: string }
      if (!res.ok) { setError(data.error ?? 'Could not save the prices.'); return }
      if (data.prices) setRows(data.prices)
      setSaved(true)
      router.refresh()
      setTimeout(() => setSaved(false), 4000)
    } catch {
      setError('Could not save the prices.')
    } finally {
      setSaving(false)
    }
  }

  const field = 'border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10'

  return (
    <section className="overflow-hidden border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/60 px-6 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Tag className="h-4 w-4 text-gray-400" /> Plan prices
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            What the pricing page shows. Leave an amount blank to publish no price —
            that plan then says &ldquo;Talk to us&rdquo;.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="flex shrink-0 items-center gap-2 bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : 'Save prices'}
        </button>
      </div>

      <div className="divide-y divide-gray-100">
        {rows.map(r => (
          <div key={r.plan} className="flex flex-wrap items-end gap-4 px-6 py-4">
            <div className="w-32 shrink-0">
              <p className="text-sm font-semibold text-gray-900">{PLANS[r.plan].label}</p>
              <p className="text-xs text-gray-400">{PLANS[r.plan].audience}</p>
            </div>

            <div className="w-24">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Currency</label>
              <input
                value={r.currency}
                onChange={e => update(r.plan, { currency: e.target.value.toUpperCase() })}
                className={`mt-1 w-full ${field}`}
              />
            </div>

            <div className="w-36">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Amount</label>
              <input
                type="number" min="0" step="0.01"
                value={r.amount ?? ''}
                placeholder="No price"
                onChange={e => update(r.plan, {
                  amount: e.target.value.trim() === '' ? null : Number(e.target.value),
                })}
                className={`mt-1 w-full ${field}`}
              />
            </div>

            <div className="w-32">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Per</label>
              <select
                value={r.period}
                onChange={e => update(r.plan, { period: e.target.value as 'month' | 'year' })}
                className={`mt-1 w-full ${field}`}
              >
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </div>

            <div className="min-w-[10rem] flex-1">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Note</label>
              <input
                value={r.unit ?? ''}
                placeholder="per workspace"
                onChange={e => update(r.plan, { unit: e.target.value })}
                className={`mt-1 w-full ${field}`}
              />
            </div>
          </div>
        ))}
      </div>

      {(error || saved) && (
        <div className="px-6 pb-5">
          {error && <p className="border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}
          {saved && (
            <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Saved. The pricing page shows these now.
            </div>
          )}
        </div>
      )}
    </section>
  )
}
