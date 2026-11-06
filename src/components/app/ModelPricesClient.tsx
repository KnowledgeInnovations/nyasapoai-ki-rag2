'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ModelPriceRow {
  model: string
  provider: string
  /** A deliberate override, or null when the published rate is in use. */
  input: number | null
  output: number | null
  cacheWrite: number | null
  cacheRead: number | null
  confirmedAt: string | null
  /** The provider's published rate, shown as the placeholder. */
  builtinInput: number | null
  builtinOutput: number | null
  builtinCacheWrite: number | null
  builtinCacheRead: number | null
  source: 'builtin' | 'override'
}

type Draft = Record<string, { input: string; output: string; cacheWrite: string; cacheRead: string }>

const str = (n: number | null) => (n === null ? '' : String(n))

const FIELDS: { key: keyof Draft[string]; label: string; hint: string; builtin: keyof ModelPriceRow }[] = [
  { key: 'input',      label: 'Input',       hint: 'per 1M input tokens',             builtin: 'builtinInput' },
  { key: 'output',     label: 'Output',      hint: 'per 1M output tokens',            builtin: 'builtinOutput' },
  { key: 'cacheWrite', label: 'Cache write', hint: 'Anthropic prompt-cache writes',   builtin: 'builtinCacheWrite' },
  { key: 'cacheRead',  label: 'Cache read',  hint: 'cached input, charged less',      builtin: 'builtinCacheRead' },
]

/**
 * The rate card, which nobody has to fill in.
 *
 * The providers' published rates ship in src/lib/modelRates.ts and are used
 * automatically, so every field here starts blank and blank means "use the
 * published rate". A value is only ever an override, for the case where the
 * account is charged something other than list price.
 *
 * The published rate is the placeholder rather than the value, so the
 * difference between "this is what we use" and "someone decided this" stays
 * visible — and clearing a field returns that model to the published rate
 * instead of making it unpriced.
 */
export default function ModelPricesClient({ initial }: { initial: ModelPriceRow[] }) {
  const router = useRouter()
  // Collapsed by default: with published rates applied automatically there is
  // nothing here that needs attention on arrival.
  const [open, setOpen] = useState(false)
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
  // Unpriced now means the rate card cannot price it at all — no published
  // rate in code and no override here.
  const unpriced = initial.filter(p => p.input === null && p.builtinInput === null).length
  const overridden = initial.filter(p => p.source === 'override').length

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
            US dollars per million tokens, applied automatically from the providers&apos;
            published prices. {unpriced > 0
              ? `${unpriced} of ${initial.length} models have no published rate and no override.`
              : overridden > 0
                ? `${overridden} overridden; the rest use published rates.`
                : 'All models are using published rates — nothing to enter.'}
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
            You do not need to fill any of this in. The greyed figure in each box is the
            provider&apos;s published rate, which is what the page already uses. Type a
            number only to override one — if your account is billed at a negotiated rate,
            or a provider changed its prices before this was updated. Clearing a box
            returns that model to the published rate. Either way an override applies to
            future calls only: every recorded call keeps the cost it was priced at, so
            figures you have already read never move.
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
                        <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Rate</th>
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
                                  placeholder={p[f.builtin] === null ? '—' : String(p[f.builtin])}
                                  aria-label={`${p.model} ${f.label} rate, US dollars per million tokens`}
                                  className="w-24 border border-gray-200 bg-white py-1.5 pl-5 pr-2 text-sm tabular-nums text-gray-800 placeholder:text-gray-300 focus:border-brand focus:outline-none"
                                />
                              </div>
                            </td>
                          ))}
                          <td className="px-2 py-2">
                            {p.source === 'override'
                              ? <span className="border border-brand/20 bg-brand/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">yours</span>
                              : p.builtinInput === null
                                ? <span className="border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">none</span>
                                : <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">published</span>}
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
            {!dirty && !saved && <span className="text-xs text-gray-400">Nothing to save — published rates are in use.</span>}
          </div>
        </div>
      )}
    </section>
  )
}
