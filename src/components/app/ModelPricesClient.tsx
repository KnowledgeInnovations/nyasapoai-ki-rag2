'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ModelPriceRow {
  model: string
  provider: string
  input: number | null
  output: number | null
  cacheWrite: number | null
  cacheRead: number | null
  confirmedAt: string | null
}

type Draft = Record<string, { input: string; output: string; cacheWrite: string; cacheRead: string }>

const str = (n: number | null) => (n === null ? '' : String(n))

const FIELDS: { key: keyof Draft[string]; label: string; hint: string }[] = [
  { key: 'input',      label: 'Input',       hint: 'per 1M input tokens' },
  { key: 'output',     label: 'Output',      hint: 'per 1M output tokens' },
  { key: 'cacheWrite', label: 'Cache write', hint: 'Anthropic prompt-cache writes' },
  { key: 'cacheRead',  label: 'Cache read',  hint: 'cached input, charged less' },
]

/**
 * The rate card.
 *
 * Deliberately starts empty rather than pre-filled with published list
 * prices. A confident wrong number in front of someone reconciling an
 * invoice is worse than a blank: the blank is visible everywhere the cost
 * appears, and the figure it produces is honest about being incomplete.
 */
export default function ModelPricesClient({ initial }: { initial: ModelPriceRow[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(initial.every(p => p.input === null))
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(initial.map(p => [p.model, {
      input: str(p.input), output: str(p.output), cacheWrite: str(p.cacheWrite), cacheRead: str(p.cacheRead),
    }])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const dirty = initial.some(p => {
    const d = draft[p.model]
    return d && (d.input !== str(p.input) || d.output !== str(p.output)
      || d.cacheWrite !== str(p.cacheWrite) || d.cacheRead !== str(p.cacheRead))
  })

  const set = (model: string, key: keyof Draft[string], value: string) => {
    setSaved(false)
    setDraft(prev => ({ ...prev, [model]: { ...prev[model], [key]: value } }))
  }

  async function save() {
    setSaving(true); setError(''); setSaved(false)
    try {
      const payload = initial.map(p => ({
        model: p.model,
        input:      draft[p.model].input === ''      ? null : Number(draft[p.model].input),
        output:     draft[p.model].output === ''     ? null : Number(draft[p.model].output),
        cacheWrite: draft[p.model].cacheWrite === '' ? null : Number(draft[p.model].cacheWrite),
        cacheRead:  draft[p.model].cacheRead === ''  ? null : Number(draft[p.model].cacheRead),
        confirmed:  draft[p.model].input !== '' && draft[p.model].output !== '',
      }))
      const res = await fetch('/api/admin/model-prices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prices: payload }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not save the rate card.')
      setSaved(true)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const byProvider = new Map<string, ModelPriceRow[]>()
  for (const p of initial) byProvider.set(p.provider, [...(byProvider.get(p.provider) ?? []), p])
  const unpriced = initial.filter(p => p.input === null || p.output === null).length

  return (
    <section className="overflow-hidden border border-gray-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/60 px-6 py-4 text-left transition hover:bg-gray-100/60"
      >
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-800">
            {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
            Rate card
          </h2>
          <p className="mt-0.5 pl-6 text-xs text-gray-500">
            US dollars per million tokens. {unpriced > 0
              ? `${unpriced} of ${initial.length} models have no rate, so their usage is counted but not costed.`
              : 'Every model has a rate.'}
          </p>
        </div>
        {unpriced > 0 && (
          <span className="shrink-0 border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            incomplete
          </span>
        )}
      </button>

      {open && (
        <div className="px-6 py-5">
          <p className="mb-4 max-w-2xl text-xs leading-relaxed text-gray-500">
            These are left blank on purpose. Published list prices change and may not be
            what you are charged, so entering them is the point at which the cost figures
            on this page become yours rather than a guess. Take the rates from your most
            recent Anthropic and OpenAI invoices. Saving a rate affects future calls only —
            each recorded call keeps the cost it was priced at, so past figures never move
            under you.
          </p>

          <div className="space-y-6">
            {[...byProvider.entries()].map(([provider, rows]) => (
              <div key={provider}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{provider}</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[42rem]">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Model</th>
                        {FIELDS.map(f => (
                          <th key={f.key} className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500" title={f.hint}>
                            {f.label}
                          </th>
                        ))}
                        <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Set</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {rows.map(p => (
                        <tr key={p.model}>
                          <td className="px-2 py-2 font-mono text-xs text-gray-700">{p.model}</td>
                          {FIELDS.map(f => (
                            <td key={f.key} className="px-2 py-2">
                              <div className="relative">
                                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">$</span>
                                <input
                                  type="number" min="0" step="0.0001" inputMode="decimal"
                                  value={draft[p.model]?.[f.key] ?? ''}
                                  onChange={e => set(p.model, f.key, e.target.value)}
                                  placeholder="—"
                                  aria-label={`${p.model} ${f.label} rate, US dollars per million tokens`}
                                  className="w-24 border border-gray-200 bg-white py-1.5 pl-5 pr-2 text-sm tabular-nums text-gray-800 placeholder:text-gray-300 focus:border-brand focus:outline-none"
                                />
                              </div>
                            </td>
                          ))}
                          <td className="px-2 py-2">
                            {p.confirmedAt
                              ? <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">yes</span>
                              : <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-300">no</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          {error && <p className="mt-4 border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving || !dirty}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white transition',
                dirty && !saving ? 'bg-brand hover:bg-brand-dark' : 'bg-gray-300',
              )}
            >
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : 'Save rates'}
            </button>
            {saved && !dirty && (
              <span className="flex items-center gap-1.5 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> Saved. New calls are priced at these rates.
              </span>
            )}
            {!dirty && !saved && <span className="text-xs text-gray-400">No changes to save.</span>}
          </div>
        </div>
      )}
    </section>
  )
}
