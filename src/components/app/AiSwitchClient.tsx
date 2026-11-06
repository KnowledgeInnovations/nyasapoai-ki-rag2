'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Power, AlertTriangle, CheckCircle2, FileStack, MessagesSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface AiSwitchState {
  training: boolean
  chat: boolean
  trainingNote: string | null
  chatNote: string | null
  changedAt: string | null
  changedBy: string | null
  /** False when the switches could not be read — see lib/modelSwitch.ts. */
  known: boolean
}

/**
 * The AI off switch.
 *
 * Two things this is trying not to be. It is not a settings row buried in a
 * list — an owner reaching for this is usually reaching for it in a hurry,
 * and it should be the first thing on the page and obvious which way it is
 * currently set. And it is not a single mystery toggle: it says, in plain
 * words next to each switch, exactly what stops working, because "turn off
 * the AI" means something different to the person paying the bill than it
 * does to the person using the product.
 *
 * Stopping answering is the destructive one — every user in every workspace
 * loses the product while it is off — so only that half asks for
 * confirmation. Stopping document processing pauses background work nobody
 * is sitting and waiting for.
 */

const AREAS = [
  {
    key: 'training' as const,
    icon: FileStack,
    title: 'Document processing',
    what: 'Reading uploads, pulling out facts, building the search index.',
    offMeans: 'New uploads are declined with an explanation, retraining stops, and the nightly catch-up job does nothing. Documents already processed are untouched and stay searchable.',
    confirm: false,
  },
  {
    key: 'chat' as const,
    icon: MessagesSquare,
    title: 'Answering questions',
    what: 'Chat answers, document search, dashboard insights.',
    offMeans: 'Everyone in every workspace is told answering is paused. This is the one your customers notice immediately.',
    confirm: true,
  },
]

export default function AiSwitchClient({ initial }: { initial: AiSwitchState }) {
  const router = useRouter()
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const allOff = !state.training && !state.chat
  const anyOff = !state.training || !state.chat

  async function change(patch: { training?: boolean; chat?: boolean }, label: string) {
    setBusy(label); setError('')
    try {
      const res = await fetch('/api/admin/ai-switch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, note: note.trim() || undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not change the switch.')
      setState(s => ({ ...s, ...json.switches, known: true }))
      setNote('')
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function toggle(key: 'training' | 'chat', turningOn: boolean, needsConfirm: boolean) {
    if (!turningOn && needsConfirm) {
      const ok = window.confirm(
        'Turn OFF answering for every workspace?\n\n'
        + 'Everyone using Nyansa AI will be told that answering is paused until you turn it back on. '
        + 'Documents and data are not affected.',
      )
      if (!ok) return
    }
    void change({ [key]: turningOn }, key)
  }

  return (
    <section
      className={cn(
        'overflow-hidden border shadow-sm',
        anyOff ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200 bg-white',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Power className={cn('h-4 w-4', anyOff ? 'text-amber-600' : 'text-emerald-600')} />
            AI models
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-gray-600">
            {allOff
              ? 'The AI models are switched off. Nothing is being sent to Anthropic or OpenAI, and nothing is being charged for them.'
              : anyOff
                ? 'Part of the AI is switched off. The detail is below.'
                : 'Everything is running normally. Switching a part off takes effect within about five seconds, across every workspace, with no deploy.'}
          </p>
          {!state.known && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The switches could not be read from the database, so both are being treated as on.
              Run migration 050 if this is a new deployment.
            </p>
          )}
        </div>

        {/* The one button the request asked for: stop everything. */}
        {!allOff ? (
          <button
            onClick={() => {
              const ok = window.confirm(
                'Turn OFF all AI?\n\n'
                + 'Document processing stops and answering stops, for every workspace, '
                + 'until you turn it back on. No data is deleted.',
              )
              if (ok) void change({ training: false, chat: false }, 'all')
            }}
            disabled={busy !== null}
            className="flex shrink-0 items-center gap-2 border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
          >
            {busy === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
            Turn off all AI
          </button>
        ) : (
          <button
            onClick={() => void change({ training: true, chat: true }, 'all')}
            disabled={busy !== null}
            className="flex shrink-0 items-center gap-2 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
            Turn all AI back on
          </button>
        )}
      </div>

      <div className="divide-y divide-gray-100">
        {AREAS.map(area => {
          const on = state[area.key]
          return (
            <div key={area.key} className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <area.icon className="h-4 w-4 text-gray-400" />
                  {area.title}
                  <span
                    className={cn(
                      'border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      on ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700',
                    )}
                  >
                    {on ? 'on' : 'off'}
                  </span>
                </p>
                <p className="mt-1 text-xs text-gray-500">{area.what}</p>
                <p className={cn('mt-1.5 max-w-xl text-xs leading-relaxed', on ? 'text-gray-400' : 'text-amber-800')}>
                  <span className="font-semibold">While off: </span>{area.offMeans}
                </p>
              </div>

              <button
                onClick={() => toggle(area.key, !on, area.confirm)}
                disabled={busy !== null}
                aria-pressed={on}
                className={cn(
                  'flex shrink-0 items-center gap-2 border px-4 py-2 text-sm font-semibold transition disabled:opacity-50',
                  on
                    ? 'border-gray-200 bg-white text-gray-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
                    : 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700',
                )}
              >
                {busy === area.key
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : on ? <Power className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                {on ? 'Turn off' : 'Turn on'}
              </button>
            </div>
          )
        })}
      </div>

      <div className="border-t border-gray-100 bg-gray-50/60 px-6 py-4">
        <label htmlFor="ai-switch-note" className="text-xs font-semibold text-gray-600">
          Reason (optional)
        </label>
        <p className="mt-0.5 text-[11px] text-gray-500">
          Saved with the change and shown below. A switch found in the off position
          three days later with no explanation costs more time than the switch saves.
        </p>
        <input
          id="ai-switch-note"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="e.g. Choosing a different model — paused while we decide"
          maxLength={500}
          className="mt-2 w-full border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-300 focus:border-brand focus:outline-none"
        />

        {(state.trainingNote || state.chatNote) && (
          <dl className="mt-3 space-y-1 text-[11px] text-gray-500">
            {state.trainingNote && <div><dt className="inline font-semibold">Document processing: </dt><dd className="inline">{state.trainingNote}</dd></div>}
            {state.chatNote && <div><dt className="inline font-semibold">Answering: </dt><dd className="inline">{state.chatNote}</dd></div>}
          </dl>
        )}
        {state.changedAt && (
          <p className="mt-2 text-[11px] text-gray-400">
            Last changed {new Date(state.changedAt).toLocaleString()}
            {state.changedBy ? ` by ${state.changedBy}` : ''}.
          </p>
        )}
      </div>

      {error && <p className="border-t border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700">{error}</p>}
    </section>
  )
}
