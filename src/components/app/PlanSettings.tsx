'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, AlertTriangle } from 'lucide-react'
import { PLANS, formatBytes, type Plan } from '@/lib/plans'
import { cn } from '@/lib/utils'

const ORDER: Plan[] = ['starter', 'professional', 'enterprise']

/** The limits a customer actually asks about, in the order they ask. */
function summarise(plan: Plan): string[] {
  const l = PLANS[plan]
  const num = (n: number | null, one: string, many = `${one}s`) =>
    n === null ? `Unlimited ${many}` : `${n.toLocaleString()} ${n === 1 ? one : many}`
  return [
    num(l.maxUsers, 'member'),
    num(l.maxSeniorUsers, 'Senior user'),
    num(l.maxDocuments, 'document'),
    l.maxStorageBytes === null ? 'Unlimited storage' : `${formatBytes(l.maxStorageBytes)} storage`,
    l.maxFileBytes === null ? 'Any file size' : `${formatBytes(l.maxFileBytes)} per file`,
    l.includedQueriesPerMonth === null
      ? 'Unlimited questions'
      : `${l.includedQueriesPerMonth.toLocaleString()} questions a month`,
  ]
}

/**
 * Changing the workspace's own plan, without us in the loop.
 *
 * Senior users only, which includes whoever created the workspace. Moving
 * down is allowed but never by accident: the first request returns what the
 * workspace already holds that the new plan would not allow, and changes
 * nothing until that has been seen and confirmed.
 */
export default function PlanSettings({ currentPlan }: { currentPlan: Plan }) {
  const router = useRouter()
  const [plan, setPlan] = useState<Plan>(currentPlan)
  const [selected, setSelected] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [overages, setOverages] = useState<string[] | null>(null)

  async function change(target: Plan, confirmed: boolean) {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch('/api/tenants/plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: target, confirmed }),
      })
      const data = await res.json() as {
        plan?: Plan; error?: string; needsConfirmation?: boolean; overages?: string[]
      }
      if (res.status === 409 && data.needsConfirmation) {
        setOverages(data.overages ?? [])
        setSelected(target)
        return
      }
      if (!res.ok) { setError(data.error ?? 'Could not change the plan.'); return }
      setPlan(data.plan ?? target)
      setOverages(null)
      setSelected(null)
      setSaved(true)
      router.refresh()
      setTimeout(() => setSaved(false), 4000)
    } catch {
      setError('Could not change the plan.')
    } finally {
      setBusy(false)
    }
  }

  const rank = (p: Plan) => ORDER.indexOf(p)

  return (
    <section className="overflow-hidden border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
        <h2 className="text-sm font-bold text-gray-800">Plan</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          You are on {PLANS[plan].label}. Change it whenever you need to — it takes effect immediately.
        </p>
      </div>

      <div className="space-y-3 p-6">
        {ORDER.map(p => {
          const isCurrent = p === plan
          const direction = rank(p) > rank(plan) ? 'Upgrade' : 'Switch down'
          return (
            <div
              key={p}
              className={cn(
                'border p-5',
                isCurrent ? 'border-brand bg-brand-light' : 'border-gray-200 bg-white',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={cn('text-sm font-bold', isCurrent ? 'text-brand' : 'text-gray-900')}>
                      {PLANS[p].label}
                    </span>
                    {isCurrent && (
                      <span className="flex items-center gap-1 border border-brand/30 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
                        <Check className="h-3 w-3" /> Current
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">{PLANS[p].audience}</p>
                </div>
                {!isCurrent && (
                  <button
                    onClick={() => change(p, false)}
                    disabled={busy}
                    className={cn(
                      'shrink-0 px-4 py-2 text-sm font-semibold transition disabled:opacity-50',
                      rank(p) > rank(plan)
                        ? 'bg-brand text-white hover:bg-brand-dark'
                        : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    {busy && selected === p ? <Loader2 className="h-4 w-4 animate-spin" /> : direction}
                  </button>
                )}
              </div>

              <ul className="mt-3 grid gap-x-6 gap-y-1 text-xs text-gray-600 sm:grid-cols-2">
                {summarise(p).map(line => (
                  <li key={line} className="flex items-center gap-1.5">
                    <Check className={cn('h-3 w-3 shrink-0', isCurrent ? 'text-brand' : 'text-gray-300')} />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}

        {error && (
          <p className="border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
        )}
        {saved && (
          <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
            <Check className="h-4 w-4" /> You are now on {PLANS[plan].label}.
          </div>
        )}
      </div>

      {/* What moving down would leave over the line. Shown before anything
          changes, because "you are now over your limits" is not something to
          discover the next time you try to add someone. */}
      {overages && selected && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-md border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="flex h-10 w-10 items-center justify-center border border-amber-200 bg-amber-50">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
            <h3 className="font-editorial mt-4 text-lg font-normal text-gray-900">
              {PLANS[selected].label} is smaller than what you are using
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              Nothing is deleted or switched off, and nobody loses access. But this
              workspace already has:
            </p>
            <ul className="mt-3 space-y-1.5">
              {overages.map(o => (
                <li key={o} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                  {o}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm leading-relaxed text-gray-500">
              You will not be able to add more of those until you are back under the
              limit, or move up again.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => { setOverages(null); setSelected(null) }}
                disabled={busy}
                className="flex-1 border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
              >
                Keep {PLANS[plan].label}
              </button>
              <button
                onClick={() => change(selected, true)}
                disabled={busy}
                className="flex-1 bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
              >
                {busy ? 'Changing…' : `Move to ${PLANS[selected].label}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
