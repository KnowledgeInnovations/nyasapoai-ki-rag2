'use client'

import { useCallback, useEffect, useState } from 'react'
import { Target, CheckCircle2, AlertCircle, Loader2, ChevronDown, Plus, Trash2, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A workspace's golden set: questions whose correct answer someone here
 * has confirmed, and what the assistant scores against them.
 *
 * Separate from the regression suite above it, and the difference is the
 * point. That one scores an answer on how confident it sounded and whether
 * it cited anything, so a confidently wrong figure passes. This compares
 * the answer to one a person checked on a named page, so "accurate" means
 * accurate.
 *
 * A drafted question is excluded from the score until confirmed, and the
 * interface says so rather than burying it: drafts come from the document's
 * own extracted facts, so a misread fact becomes a question that rewards
 * repeating the misreading.
 */

interface GoldenQuestion {
  id: string
  question: string
  expected_answer: string
  expected_kind: 'figure' | 'set' | 'absent' | 'claim'
  source_page: number | null
  document_id: string | null
  verified_by: string | null
  verified_at: string | null
  notes: string | null
}

interface Band { label: string; answers: number; correct: number; accuracy: number | null }

interface Run {
  id: string
  questions: number
  correct: number
  calibration: Band[]
  results: { question: string; correct: boolean; reason: string; confidence: number }[]
  created_at: string
}

interface LiveResult {
  question: string
  correct: boolean
  reason: string
  confidence: number
  citations: number
}

export default function GoldenSetCard({ documents }: { documents: { id: string; title: string }[] }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [verified, setVerified] = useState<GoldenQuestion[]>([])
  const [drafts, setDrafts] = useState<GoldenQuestion[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [live, setLive] = useState<{ status: 'idle' | 'running' | 'done'; results: LiveResult[]; message: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draftFrom, setDraftFrom] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/golden-questions')
      if (!res.ok) throw new Error('Could not load the golden set')
      const data = await res.json()
      setVerified(data.verified ?? [])
      setDrafts(data.drafts ?? [])
      setRuns(data.runs ?? [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (open) load() }, [open, load])

  async function confirmDraft(id: string) {
    setBusy(id); setError(null)
    const res = await fetch('/api/golden-questions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, verify: true }),
    })
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Could not confirm it')
    setBusy(null)
    await load()
  }

  async function removeQuestion(id: string) {
    setBusy(id); setError(null)
    const res = await fetch(`/api/golden-questions?id=${id}`, { method: 'DELETE' })
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Could not remove it')
    setBusy(null)
    await load()
  }

  async function draft() {
    if (!draftFrom) return
    setBusy('draft'); setError(null)
    const res = await fetch('/api/golden-questions/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: draftFrom }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) setError(data.error ?? 'Could not draft any questions')
    setBusy(null)
    await load()
  }

  async function run() {
    setLive({ status: 'running', results: [], message: 'Starting…' })
    setError(null)
    try {
      const res = await fetch('/api/golden-questions/run', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Could not run the set')
        setLive(null)
        return
      }
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const results: LiveResult[] = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const event = JSON.parse(line.slice(6))
          if (event.stage === 'asking') {
            setLive({ status: 'running', results: [...results], message: `Asking ${event.index + 1} of ${event.total}: ${event.question}` })
          } else if (event.stage === 'result') {
            results.push(event)
            setLive({ status: 'running', results: [...results], message: `${results.length} of ${event.total} asked` })
          } else if (event.stage === 'complete') {
            setLive({
              status: 'done',
              results: [...results],
              message: `${event.correct} of ${event.questions} correct (${event.accuracy}%)` +
                (event.ranOutOfTime ? ` — ran out of time with ${event.skipped} unasked` : ''),
            })
          }
        }
      }
      await load()
    } catch (e) {
      setError((e as Error).message)
      setLive(null)
    }
  }

  const lastRun = runs[0]
  const accuracy = lastRun ? Math.round((lastRun.correct / Math.max(1, lastRun.questions)) * 100) : null

  return (
    <div className="mb-5 border border-gray-200 bg-white">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border border-brand/20 bg-brand-light">
            <Target className="h-4.5 w-4.5 text-brand" />
          </div>
          <div>
            <p className="font-editorial text-base text-gray-900">Accuracy check</p>
            <p className="mt-0.5 text-xs text-gray-500">
              Questions whose right answer someone here has confirmed, so &ldquo;accurate&rdquo; is measured rather than assumed.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {accuracy != null && (
            <span className={cn(
              'px-2 py-1 text-[11px] font-semibold',
              accuracy >= 90 ? 'bg-green-50 text-green-700 border border-green-200'
                : accuracy >= 70 ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-red-50 text-red-700 border border-red-200',
            )}>
              {accuracy}% last run
            </span>
          )}
          <ChevronDown className={cn('h-4 w-4 text-gray-400 transition', open && 'rotate-180')} />
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-200 px-5 py-4">
          {error && (
            <div className="mb-3 flex items-start gap-2 border border-red-200 bg-red-50 px-3 py-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 py-6 text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /><span className="text-xs">Loading…</span>
            </div>
          ) : (
            <>
              {/* Confirmed questions — the only ones that count */}
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Confirmed questions ({verified.length})
                </p>
                <button
                  onClick={run}
                  disabled={!verified.length || live?.status === 'running'}
                  className="border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-40">
                  {live?.status === 'running' ? 'Running…' : 'Run the check'}
                </button>
              </div>

              {verified.length === 0 ? (
                <p className="mt-2 text-xs text-gray-500">
                  None yet. Draft some from a document below, then check each answer against its page and confirm it.
                  Until a question is confirmed it does not count — a draft comes from what we extracted, so if we
                  misread something the draft would reward us for misreading it again.
                </p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {verified.map(q => {
                    const result = live?.results.find(r => r.question === q.question)
                    return (
                      <div key={q.id} className="flex items-start gap-2 border border-gray-100 bg-gray-50/60 px-3 py-2">
                        {result
                          ? result.correct
                            ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                            : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                          : <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-gray-800">{q.question}</p>
                          <p className="mt-0.5 text-[11px] text-gray-500">
                            Expected: {q.expected_answer}
                            {q.source_page != null && ` · page ${q.source_page}`}
                            {q.verified_by && ` · confirmed by ${q.verified_by}`}
                          </p>
                          {result && (
                            <p className={cn('mt-0.5 text-[11px]', result.correct ? 'text-green-700' : 'text-red-700')}>
                              {result.reason} · {result.confidence}% confidence
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => removeQuestion(q.id)}
                          disabled={busy === q.id}
                          title="Remove this question"
                          className="shrink-0 text-gray-300 transition hover:text-red-500 disabled:opacity-40">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {live && (
                <p className="mt-2 text-[11px] text-gray-500">{live.message}</p>
              )}

              {/* Calibration — whether the confidence was deserved */}
              {lastRun?.calibration?.length ? (
                <div className="mt-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                    Was the confidence deserved?
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {lastRun.calibration.map(band => (
                      <div key={band.label} className="border border-gray-100 bg-gray-50/60 px-2 py-1.5">
                        <p className="text-[10px] text-gray-500">{band.label}</p>
                        <p className="text-xs font-semibold text-gray-800">
                          {band.answers === 0 ? '—' : `${band.accuracy}% of ${band.answers}`}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-gray-400">
                    An answer scoring high and being wrong, or scoring low and being right, is the same fault in
                    opposite directions.
                  </p>
                </div>
              ) : null}

              {/* Drafts awaiting confirmation */}
              {drafts.length > 0 && (
                <div className="mt-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                    Awaiting confirmation ({drafts.length}) — not counted yet
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {drafts.map(q => (
                      <div key={q.id} className="border border-amber-200 bg-amber-50/50 px-3 py-2">
                        <p className="text-xs text-gray-800">{q.question}</p>
                        <p className="mt-0.5 text-[11px] text-gray-600">
                          We think the answer is <span className="font-semibold">{q.expected_answer}</span>
                          {q.source_page != null && ` — check page ${q.source_page}`}
                        </p>
                        <div className="mt-1.5 flex gap-2">
                          <button
                            onClick={() => confirmDraft(q.id)}
                            disabled={busy === q.id}
                            className="border border-green-300 bg-white px-2 py-1 text-[11px] font-semibold text-green-700 transition hover:bg-green-50 disabled:opacity-40">
                            That&rsquo;s right — count it
                          </button>
                          <button
                            onClick={() => removeQuestion(q.id)}
                            disabled={busy === q.id}
                            className="border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-40">
                            Discard
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Draft from a document */}
              <div className="mt-4 border-t border-gray-100 pt-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Draft questions from a document
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={draftFrom}
                    onChange={e => setDraftFrom(e.target.value)}
                    className="min-w-0 flex-1 border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700">
                    <option value="">Choose a document…</option>
                    {documents.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                  <button
                    onClick={draft}
                    disabled={!draftFrom || busy === 'draft'}
                    className="flex items-center gap-1.5 border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-40">
                    {busy === 'draft' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    Draft
                  </button>
                </div>
                <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-gray-400">
                  <FileText className="mt-0.5 h-3 w-3 shrink-0" />
                  Drafts are taken from what we extracted, and each names the page it came from. Open the page before
                  confirming — a draft built on a misread fact would score us full marks for misreading it.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
