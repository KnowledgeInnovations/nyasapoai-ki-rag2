'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Brain, CheckCircle2, AlertCircle, Clock, RefreshCw, Zap,
  FileText, ChevronDown, ChevronUp, X, ClipboardCheck, Check,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { TrainingDoc, Assessment, AssessmentResultRow } from '@/app/(app)/training/page'

type TrainStatus = 'idle' | 'running' | 'done' | 'error'

interface TrainState {
  status:   TrainStatus
  message:  string
  progress: number
  chunks:   number
  log:      string[]
}

interface AssessmentState {
  status:        TrainStatus
  message:       string
  progress:      number
  log:           string[]
  accuracy:      number | null
  avgConfidence: number | null
  total:         number
  passed:        number
  results:       AssessmentResultRow[]
}

const EMPTY_ASSESSMENT_STATE: AssessmentState = {
  status: 'idle', message: '', progress: 0, log: [],
  accuracy: null, avgConfidence: null, total: 0, passed: 0, results: [],
}

function performanceLabel(accuracy: number): { label: string; color: string } {
  if (accuracy >= 80) return { label: 'High', color: 'text-green-700 bg-green-50 border-green-200' }
  if (accuracy >= 50) return { label: 'Medium', color: 'text-amber-700 bg-amber-50 border-amber-200' }
  return { label: 'Low', color: 'text-red-700 bg-red-50 border-red-200' }
}

function ext(source: string) {
  return source.split('.').pop()?.toUpperCase() ?? 'FILE'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const DEPT_LABELS: Record<string, string> = {
  contracts:       'Contracts',
  'site-reports':  'Site Reports',
  finance:         'Finance',
  legal:           'Legal',
  'design-plans':  'Design & Plans',
  'board-reports': 'Board Reports',
  general:         'General',
}

export default function TrainingClient({ docs, trainedCount, untrainedCount, latestAssessment }: {
  docs: TrainingDoc[]
  trainedCount: number
  untrainedCount: number
  latestAssessment: Assessment | null
}) {
  const router = useRouter()
  const [states,    setStates]    = useState<Record<string, TrainState>>({})
  const [sheetDoc,  setSheetDoc]  = useState<TrainingDoc | null>(null)
  const abortRefs = useRef<Record<string, AbortController>>({})

  // Self-assessment: target=null means whole-knowledge-base run.
  const [assessmentOpen,   setAssessmentOpen]   = useState(false)
  const [assessmentTarget, setAssessmentTarget] = useState<{ documentId: string | null; title: string } | null>(null)
  const [assessmentState,  setAssessmentState]  = useState<AssessmentState>(EMPTY_ASSESSMENT_STATE)
  const assessmentAbort = useRef<AbortController | null>(null)

  const totalChunks = docs.reduce((a, d) => a + d.chunkCount, 0)

  async function runAssessment(documentId: string | null, title: string) {
    setAssessmentTarget({ documentId, title })
    setAssessmentOpen(true)
    setAssessmentState({ ...EMPTY_ASSESSMENT_STATE, status: 'running', message: 'Starting…' })

    const abort = new AbortController()
    assessmentAbort.current = abort

    try {
      const res = await fetch('/api/assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
        signal: abort.signal,
      })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6)) as {
              stage: string; message: string; progress: number
              accuracy?: number; avgConfidence?: number; total?: number; passed?: number
              results?: AssessmentResultRow[]
            }
            const status: TrainStatus = ev.stage === 'complete' ? 'done' : ev.stage === 'error' ? 'error' : 'running'
            setAssessmentState(prev => ({
              ...prev,
              status, message: ev.message, progress: Math.max(ev.progress, 0),
              log: [...prev.log, ev.message],
              accuracy: ev.accuracy ?? prev.accuracy,
              avgConfidence: ev.avgConfidence ?? prev.avgConfidence,
              total: ev.total ?? prev.total,
              passed: ev.passed ?? prev.passed,
              results: ev.results ?? prev.results,
            }))
          } catch {}
        }
      }
      router.refresh()
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setAssessmentState(prev => ({ ...prev, status: 'error', message: (err as Error).message }))
      }
    }
  }

  function getState(id: string): TrainState {
    return states[id] ?? { status: 'idle', message: '', progress: 0, chunks: 0, log: [] }
  }

  function patchState(id: string, update: Partial<TrainState> | ((p: TrainState) => Partial<TrainState>)) {
    setStates(prev => {
      const cur = prev[id] ?? { status: 'idle', message: '', progress: 0, chunks: 0, log: [] }
      const patch = typeof update === 'function' ? update(cur) : update
      return { ...prev, [id]: { ...cur, ...patch } }
    })
  }

  async function trainDocument(doc: TrainingDoc) {
    const abort = new AbortController()
    abortRefs.current[doc.id] = abort
    patchState(doc.id, { status: 'running', message: 'Starting…', progress: 0, chunks: 0, log: [] })
    let finalStatus: TrainStatus = 'running'
    try {
      const res = await fetch(`/api/documents/${doc.id}/train`, { method: 'POST', signal: abort.signal })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6)) as { stage: string; message: string; progress: number; chunkCount?: number }
            const s: TrainStatus = ev.stage === 'complete' ? 'done' : ev.stage === 'error' ? 'error' : 'running'
            finalStatus = s
            patchState(doc.id, prev => ({
              status: s, message: ev.message, progress: Math.max(ev.progress, 0),
              chunks: ev.chunkCount ?? prev.chunks,
              log: [...prev.log, ev.message],
            }))
          } catch {}
        }
      }
      if (finalStatus === 'done') router.refresh()
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        patchState(doc.id, { status: 'error', message: (err as Error).message })
      }
    }
  }

  function trainAll() {
    docs.filter(d => getState(d.id).status === 'idle' && d.chunkCount === 0).forEach(trainDocument)
  }

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">AI Training</h1>
          <p className="mt-1 text-sm text-gray-500">
            Train the AI on each document so it can answer questions from its contents.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={() => runAssessment(null, 'Whole Knowledge Base')}
            disabled={assessmentState.status === 'running'}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50">
            <ClipboardCheck className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Run Self-Assessment</span>
            <span className="sm:hidden">Assess</span>
          </button>
          {untrainedCount > 0 && (
            <button onClick={trainAll}
              className="flex items-center gap-2 rounded-xl bg-brand px-3.5 py-2.5 text-xs font-semibold text-white shadow-md shadow-brand/20 transition hover:bg-brand-dark">
              <Zap className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Train All ({untrainedCount})</span>
              <span className="sm:hidden">{untrainedCount}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Stats — 4-col on all screens ────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-2xl font-black tracking-tight text-gray-900">{docs.length}</p>
          <p className="mt-0.5 text-xs text-gray-500">Total</p>
        </div>
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 shadow-sm">
          <p className="text-2xl font-black tracking-tight text-green-700">{trainedCount}</p>
          <p className="mt-0.5 text-xs text-green-600">Trained</p>
          <p className="mt-0.5 text-[10px] text-green-500">{totalChunks.toLocaleString()} chunks</p>
        </div>
        <div className={cn('rounded-2xl border p-4 shadow-sm', untrainedCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white')}>
          <p className={cn('text-2xl font-black tracking-tight', untrainedCount > 0 ? 'text-amber-700' : 'text-gray-300')}>{untrainedCount}</p>
          <p className={cn('mt-0.5 text-xs', untrainedCount > 0 ? 'text-amber-600' : 'text-gray-400')}>Pending</p>
        </div>
        <div className={cn('rounded-2xl border p-4 shadow-sm', latestAssessment ? performanceLabel(latestAssessment.accuracy).color : 'border-gray-200 bg-white')}>
          {latestAssessment ? (
            <>
              <p className="text-2xl font-black tracking-tight">{latestAssessment.accuracy}%</p>
              <p className="mt-0.5 text-xs">Accuracy · {performanceLabel(latestAssessment.accuracy).label}</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-black tracking-tight text-gray-300">—</p>
              <p className="mt-0.5 text-xs text-gray-400">Not yet assessed</p>
            </>
          )}
        </div>
      </div>

      {/* ── Document cards — 2-col grid ──────────────────────────── */}
      {docs.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white p-12 text-center">
          <Brain className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-500">No documents uploaded yet</p>
          <p className="mt-1 text-xs text-gray-400">Upload documents in the Documents section first.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {docs.map(doc => {
            const s = getState(doc.id)
            const isRunning = s.status === 'running'
            const isDone    = s.status === 'done' || (s.status === 'idle' && doc.chunkCount > 0)
            const isFailed  = s.status === 'error' || (s.status === 'idle' && doc.status === 'failed')
            const chunkCount = s.status === 'done' ? s.chunks : doc.chunkCount

            return (
              <div
                key={doc.id}
                className={cn(
                  'relative rounded-2xl border bg-white p-4 shadow-sm transition',
                  isRunning ? 'border-brand/30 bg-brand-light/20' : 'border-gray-200',
                )}
              >
                {/* Doc icon + title */}
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
                    isDone ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50',
                  )}>
                    <FileText className={cn('h-4 w-4', isDone ? 'text-green-500' : 'text-gray-400')} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{doc.title}</p>
                    <p className="truncate text-[11px] text-gray-400">
                      {doc.department ? (DEPT_LABELS[doc.department] ?? doc.department) : 'Uncategorised'}
                      {' · '}
                      <span className="font-medium">{ext(doc.source)}</span>
                    </p>
                  </div>
                </div>

                {/* Progress bar while running */}
                {isRunning && (
                  <div className="mt-3">
                    <div className="mb-1 flex items-center gap-1.5">
                      <RefreshCw className="h-3 w-3 animate-spin text-brand" />
                      <span className="text-[11px] font-semibold text-brand">{s.progress}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${s.progress}%` }} />
                    </div>
                    <p className="mt-1 truncate text-[10px] text-gray-400">{s.message}</p>
                  </div>
                )}

                {/* Status row */}
                {!isRunning && (
                  <div className="mt-3 flex items-center gap-1.5">
                    {isDone && <><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /><span className="text-[11px] font-semibold text-green-700">Trained · {chunkCount.toLocaleString()} chunks</span></>}
                    {isFailed && !isDone && <><AlertCircle className="h-3.5 w-3.5 text-red-500" /><span className="text-[11px] font-semibold text-red-600">Failed</span></>}
                    {!isDone && !isFailed && <><Clock className="h-3.5 w-3.5 text-amber-400" /><span className="text-[11px] font-semibold text-amber-600">Not trained</span></>}
                  </div>
                )}

                {/* Actions */}
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => trainDocument(doc)}
                    disabled={isRunning}
                    className={cn(
                      'flex-1 rounded-xl py-2 text-xs font-semibold transition disabled:opacity-50',
                      isDone
                        ? 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                        : 'bg-brand text-white shadow-sm hover:bg-brand-dark',
                    )}>
                    <Brain className="mr-1 inline-block h-3 w-3" />
                    {isRunning ? 'Training…' : isDone ? 'Retrain' : 'Train'}
                  </button>
                  {/* Detail button — opens bottom sheet */}
                  <button
                    onClick={() => setSheetDoc(doc)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-500 transition hover:bg-gray-100"
                    title="View details">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Detail bottom sheet ──────────────────────────────────── */}
      {sheetDoc && (
        <DetailSheet
          doc={sheetDoc}
          state={getState(sheetDoc.id)}
          onTrain={() => trainDocument(sheetDoc)}
          onAssess={() => runAssessment(sheetDoc.id, sheetDoc.title)}
          onClose={() => setSheetDoc(null)}
        />
      )}

      {/* ── Self-assessment sheet ────────────────────────────────── */}
      {assessmentOpen && assessmentTarget && (
        <AssessmentSheet
          target={assessmentTarget}
          state={assessmentState}
          onClose={() => {
            assessmentAbort.current?.abort()
            setAssessmentOpen(false)
          }}
        />
      )}
    </div>
  )
}

/* ── Self-Assessment Sheet ───────────────────────────────────── */
function AssessmentSheet({
  target, state, onClose,
}: {
  target: { documentId: string | null; title: string }
  state: AssessmentState
  onClose: () => void
}) {
  const isRunning = state.status === 'running'
  const isDone    = state.status === 'done'
  const isFailed  = state.status === 'error'
  const [logOpen, setLogOpen] = useState(true)
  const [resultsOpen, setResultsOpen] = useState(true)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-gray-200 bg-white shadow-2xl">
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-gray-300" />

        <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-4">
          <div className="min-w-0">
            <p className="truncate font-bold text-gray-900">Self-Assessment</p>
            <p className="mt-0.5 truncate text-xs text-gray-400">{target.title}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress bar while running */}
        {isRunning && (
          <div className="mx-5 mt-1 rounded-xl border border-brand/20 bg-brand-light/40 p-4">
            <div className="mb-2 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-brand" />
              <span className="text-sm font-semibold text-brand">Assessing… {state.progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-brand/10">
              <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${state.progress}%` }} />
            </div>
            {state.message && <p className="mt-2 truncate text-xs text-brand/70">{state.message}</p>}
          </div>
        )}

        {isFailed && (
          <div className="mx-5 mt-1 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-red-800">Assessment failed</p>
              <p className="text-xs text-red-600">{state.message || 'An error occurred.'}</p>
            </div>
          </div>
        )}

        {/* Summary */}
        {isDone && state.accuracy != null && (
          <div className="mx-5 mt-1 grid grid-cols-2 gap-3">
            <div className={cn('rounded-2xl border p-4', performanceLabel(state.accuracy).color)}>
              <p className="text-2xl font-black tracking-tight">{state.accuracy}%</p>
              <p className="mt-0.5 text-xs">Accuracy · {performanceLabel(state.accuracy).label}</p>
              <p className="mt-0.5 text-[10px] opacity-70">{state.passed}/{state.total} passed</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-2xl font-black tracking-tight text-gray-900">{state.avgConfidence}%</p>
              <p className="mt-0.5 text-xs text-gray-500">Avg. confidence</p>
            </div>
          </div>
        )}

        {/* Live log */}
        {state.log.length > 0 && (
          <div className="mx-5 mt-4 rounded-xl border border-gray-200 bg-gray-50">
            <button
              onClick={() => setLogOpen(o => !o)}
              className="flex w-full items-center justify-between px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">
              Log
              {logOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {logOpen && (
              <div className="border-t border-gray-200 px-4 pb-3 pt-2 space-y-1.5 max-h-40 overflow-y-auto">
                {state.log.map((line, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand/40" />
                    <p className="text-xs text-gray-600">{line}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Per-question results */}
        {isDone && state.results.length > 0 && (
          <div className="mx-5 mb-5 mt-4 rounded-xl border border-gray-200 bg-white">
            <button
              onClick={() => setResultsOpen(o => !o)}
              className="flex w-full items-center justify-between px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">
              Questions ({state.results.length})
              {resultsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {resultsOpen && (
              <div className="space-y-2 border-t border-gray-200 p-3">
                {state.results.map((r, i) => (
                  <div key={i} className={cn(
                    'rounded-xl border p-3',
                    r.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50',
                  )}>
                    <div className="flex items-start gap-2">
                      {r.passed
                        ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                        : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-gray-800">{r.question}</p>
                        {r.expected && 'value' in r.expected && (
                          <p className="mt-1 text-[11px] text-gray-500">
                            Expected: {r.expected.value} {r.expected.unit} ({r.expected.entity}, {r.expected.fiscalYear ?? '—'})
                          </p>
                        )}
                        {r.expected && 'growthPct' in r.expected && (
                          <p className="mt-1 text-[11px] text-gray-500">
                            Expected: {r.expected.entity} {r.expected.metric.replace(/_/g, ' ')} change {r.expected.fromYear} → {r.expected.toYear} = {r.expected.growthPct > 0 ? '+' : ''}{r.expected.growthPct}%
                          </p>
                        )}
                        {r.expected && 'docTitle' in r.expected && (
                          <p className="mt-1 text-[11px] text-gray-500">Expected file: {r.expected.docTitle}</p>
                        )}
                        {r.expected && 'answer' in r.expected && (
                          <p className="mt-1 text-[11px] text-gray-500">Reference answer: {r.expected.answer}</p>
                        )}
                        <p className="mt-1 text-[11px] text-gray-600">{r.answerExcerpt}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                            Confidence {r.confidenceScore}%
                          </span>
                          {!r.numericMatch && (
                            <span className="rounded-full border border-red-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-red-500">
                              Answer mismatch
                            </span>
                          )}
                          {r.risks.map((risk, j) => (
                            <span key={j} className="rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                              {risk}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!isDone && !isFailed && state.results.length === 0 && (
          <div className="h-5" />
        )}
      </div>
    </>
  )
}

/* ── Detail Sheet ────────────────────────────────────────────── */
function DetailSheet({
  doc, state, onTrain, onAssess, onClose,
}: {
  doc: TrainingDoc
  state: TrainState
  onTrain: () => void
  onAssess: () => void
  onClose: () => void
}) {
  const isRunning  = state.status === 'running'
  const isDone     = state.status === 'done' || (state.status === 'idle' && doc.chunkCount > 0)
  const isFailed   = state.status === 'error' || (state.status === 'idle' && doc.status === 'failed')
  const chunkCount = state.status === 'done' ? state.chunks : doc.chunkCount

  const [logOpen, setLogOpen] = useState(true)
  const [docAssessment, setDocAssessment] = useState<Assessment | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/assessment?documentId=${doc.id}`)
      .then(res => res.json())
      .then(data => { if (!cancelled) setDocAssessment(data.assessment ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [doc.id])

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet — slides up from bottom */}
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-gray-200 bg-white shadow-2xl">
        {/* Handle */}
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-gray-300" />

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-4">
          <div className="min-w-0">
            <p className="truncate font-bold text-gray-900">{doc.title}</p>
            <p className="mt-0.5 truncate text-xs text-gray-400">{doc.source}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Meta chips */}
        <div className="flex flex-wrap gap-2 px-5">
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-500">
            {doc.source.split('.').pop()?.toUpperCase()}
          </span>
          {doc.department && (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-500 capitalize">
              {doc.department.replace(/-/g, ' ')}
            </span>
          )}
          {isDone && (
            <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-700">
              ✓ {chunkCount.toLocaleString()} chunks trained
            </span>
          )}
          {doc.lastTrainedAt && (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-400">
              Last trained {new Date(doc.lastTrainedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
          {docAssessment && (
            <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', performanceLabel(docAssessment.accuracy).color)}>
              {docAssessment.accuracy}% accuracy · {performanceLabel(docAssessment.accuracy).label}
            </span>
          )}
        </div>

        {/* Progress bar (if running) */}
        {isRunning && (
          <div className="mx-5 mt-4 rounded-xl border border-brand/20 bg-brand-light/40 p-4">
            <div className="mb-2 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-brand" />
              <span className="text-sm font-semibold text-brand">Training… {state.progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-brand/10">
              <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${state.progress}%` }} />
            </div>
            {state.message && <p className="mt-2 text-xs text-brand/70">{state.message}</p>}
          </div>
        )}

        {/* Status */}
        {!isRunning && (
          <div className="mx-5 mt-4">
            {isDone && (
              <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-sm font-semibold text-green-800">Training complete</p>
                  <p className="text-xs text-green-600">AI can now answer questions from this document.</p>
                </div>
              </div>
            )}
            {isFailed && !isDone && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <AlertCircle className="h-5 w-5 text-red-500" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Training failed</p>
                  <p className="text-xs text-red-600">{state.message || 'An error occurred. Try retraining.'}</p>
                </div>
              </div>
            )}
            {!isDone && !isFailed && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <Clock className="h-5 w-5 text-amber-500" />
                <p className="text-sm font-semibold text-amber-800">Not yet trained</p>
              </div>
            )}
          </div>
        )}

        {/* Training log */}
        {state.log.length > 0 && (
          <div className="mx-5 mt-4 rounded-xl border border-gray-200 bg-gray-50">
            <button
              onClick={() => setLogOpen(o => !o)}
              className="flex w-full items-center justify-between px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">
              Training Log
              {logOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {logOpen && (
              <div className="border-t border-gray-200 px-4 pb-3 pt-2 space-y-1.5">
                {state.log.map((line, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand/40" />
                    <p className="text-xs text-gray-600">{line}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 p-5">
          <button
            onClick={() => { onTrain(); }}
            disabled={isRunning}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition disabled:opacity-50',
              isDone
                ? 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                : 'bg-brand text-white shadow-lg shadow-brand/20 hover:bg-brand-dark',
            )}>
            <Brain className="h-4 w-4" />
            {isRunning ? 'Training in progress…' : isDone ? 'Retrain document' : 'Train document'}
          </button>
          {isDone && (
            <button
              onClick={onAssess}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50">
              <ClipboardCheck className="h-4 w-4" />
              Assess this document
            </button>
          )}
        </div>
      </div>
    </>
  )
}
