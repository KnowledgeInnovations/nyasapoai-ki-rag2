'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Brain, CheckCircle2, AlertCircle, AlertTriangle, Clock, RefreshCw, Zap,
  FileText, ChevronDown, ChevronUp, X, Search, Quote, Sparkles, ClipboardCheck,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { TrainingDoc, Performance, SelfAssessmentRun, RegressionResultRow } from '@/app/(app)/training/page'
import { REGRESSION_QUESTIONS } from '@/lib/selfAssessment'

const REGRESSION_QUESTION_COUNT = REGRESSION_QUESTIONS.length

type TrainStatus = 'idle' | 'running' | 'done' | 'error'

interface TrainState {
  status:   TrainStatus
  message:  string
  progress: number
  chunks:   number
  log:      string[]
}

interface SearchExcerpt {
  pageNumber:   number | null
  sectionTitle: string | null
  text:         string
}

interface SearchResultDoc {
  documentId: string
  title:      string
  source:     string
  excerpts:   SearchExcerpt[]
}

interface DirectFact {
  fiscalYear:    string | null
  entity:        string
  entityType:    string
  metric:        string
  value:         number
  unit:          string
  documentId:    string
  documentTitle: string
  pageNumber:    number | null
  sectionTitle:  string | null
}

interface ReviewResult {
  verdict:   'correct' | 'incorrect'
  reasoning: string
}

interface SearchState {
  status:    TrainStatus
  message:   string
  question:  string
  keywords:  string[]
  facts:     DirectFact[]
  documents: SearchResultDoc[]
  review:    ReviewResult | null
}

const EMPTY_SEARCH_STATE: SearchState = {
  status: 'idle', message: '', question: '', keywords: [], facts: [], documents: [], review: null,
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

// Humanizes the fixed `step` identifiers train/route.ts pushes onto
// processing_warnings — falls back to the raw id for anything unrecognized.
const WARNING_STEP_LABELS: Record<string, string> = {
  table_cleaning:           'AI table cleaning',
  table_extraction:         'Table extraction',
  ai_table_facts:           'AI table fact extraction',
  generic_facts_fallback:   'Generic fact extraction',
  cross_doc_corroboration:  'Cross-document corroboration',
}

// A document can be marked "ready" with some AI-enhancement steps having
// silently failed and continued with partial data (intentional, see
// train/route.ts) — surfaced here instead of looking identical to a fully
// clean run.
function isDegraded(doc: TrainingDoc, status: TrainStatus): boolean {
  return (doc.processing_warnings?.length ?? 0) > 0 && status !== 'running'
}

export default function TrainingClient({ docs, trainedCount, untrainedCount, performance, lastRun }: {
  docs: TrainingDoc[]
  trainedCount: number
  untrainedCount: number
  performance: Performance | null
  lastRun: SelfAssessmentRun | null
}) {
  const router = useRouter()
  const [states,    setStates]    = useState<Record<string, TrainState>>({})
  const [sheetDoc,  setSheetDoc]  = useState<TrainingDoc | null>(null)
  const abortRefs = useRef<Record<string, AbortController>>({})

  // Regression suite (self-assessment) run state.
  const [regression, setRegression] = useState<{
    status: 'idle' | 'running' | 'done' | 'error'
    message: string
    results: RegressionResultRow[]
    summary: { total: number; passed: number; accuracy: number; avgConfidence: number } | null
  }>({ status: 'idle', message: '', results: [], summary: null })
  const [regressionOpen, setRegressionOpen] = useState(false)

  // Manual document search: target=null means search the whole knowledge base.
  const [searchOpen,   setSearchOpen]   = useState(false)
  const [searchTarget, setSearchTarget] = useState<{ documentId: string | null; title: string } | null>(null)
  const [searchState,  setSearchState]  = useState<SearchState>(EMPTY_SEARCH_STATE)
  const [livePerf,     setLivePerf]     = useState<Performance | null>(performance)
  const [reviewVersion, setReviewVersion] = useState(0)

  const totalChunks = docs.reduce((a, d) => a + d.chunkCount, 0)

  async function runSearch(documentId: string | null, title: string, question: string) {
    setSearchTarget({ documentId, title })
    setSearchOpen(true)
    setSearchState({ ...EMPTY_SEARCH_STATE, status: 'running', question })

    try {
      const res = await fetch('/api/document-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, documentId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`)
      const review: ReviewResult | null = data.review ?? null
      setSearchState({
        status: 'done', message: '', question,
        keywords: data.keywords ?? [], facts: data.facts ?? [], documents: data.documents ?? [],
        review,
      })
      // The AI verdict was recorded server-side — reflect it in the
      // performance stats immediately without an extra round trip.
      if (review) {
        if (documentId === null) {
          setLivePerf(prev => {
            const total   = (prev?.total ?? 0) + 1
            const correct = (prev?.correct ?? 0) + (review.verdict === 'correct' ? 1 : 0)
            return { total, correct, accuracy: Math.round((correct / total) * 10000) / 100 }
          })
        }
        setReviewVersion(v => v + 1)
        router.refresh()
      }
    } catch (err) {
      setSearchState(prev => ({ ...prev, status: 'error', message: (err as Error).message }))
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

  async function runRegressionSuite() {
    setRegressionOpen(true)
    setRegression({ status: 'running', message: 'Starting…', results: [], summary: null })
    try {
      const res = await fetch('/api/self-assessment', { method: 'POST' })
      if (!res.ok || !res.body) throw new Error(`Server returned ${res.status}`)
      const reader  = res.body.getReader()
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
            const ev = JSON.parse(line.slice(6))
            if (ev.stage === 'running') {
              setRegression(prev => ({ ...prev, message: ev.message }))
            } else if (ev.stage === 'result') {
              setRegression(prev => ({ ...prev, results: [...prev.results, ev as RegressionResultRow] }))
            } else if (ev.stage === 'complete') {
              setRegression(prev => ({
                ...prev, status: 'done', message: '',
                summary: { total: ev.total, passed: ev.passed, accuracy: ev.accuracy, avgConfidence: ev.avgConfidence },
              }))
              router.refresh()
            }
          } catch {}
        }
      }
    } catch (err) {
      setRegression(prev => ({ ...prev, status: 'error', message: (err as Error).message }))
    }
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
          <button onClick={() => { setSearchTarget({ documentId: null, title: 'Whole Knowledge Base' }); setSearchOpen(true); setSearchState(EMPTY_SEARCH_STATE) }}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50">
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search Documents</span>
            <span className="sm:hidden">Search</span>
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
        <div className={cn('rounded-2xl border p-4 shadow-sm', livePerf ? performanceLabel(livePerf.accuracy).color : 'border-gray-200 bg-white')}>
          {livePerf ? (
            <>
              <p className="text-2xl font-black tracking-tight">{livePerf.accuracy}%</p>
              <p className="mt-0.5 text-xs">Performance · {performanceLabel(livePerf.accuracy).label}</p>
              <p className="mt-0.5 text-[10px] opacity-70">{livePerf.correct}/{livePerf.total} reviewed correct</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-black tracking-tight text-gray-300">—</p>
              <p className="mt-0.5 text-xs text-gray-400">No reviews yet</p>
            </>
          )}
        </div>
      </div>

      {/* ── Regression suite (self-assessment) ──────────────────── */}
      <RegressionSuiteCard
        lastRun={lastRun}
        live={regression}
        open={regressionOpen}
        onToggle={() => setRegressionOpen(o => !o)}
        onRun={runRegressionSuite}
      />

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
            const degraded  = isDone && isDegraded(doc, s.status)
            const chunkCount = s.status === 'done' ? s.chunks : doc.chunkCount
            const factCount  = doc.financialFactCount + doc.documentFactCount

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
                  <div className="mt-3 flex items-center gap-1.5" title={degraded ? doc.status_detail ?? undefined : undefined}>
                    {isDone && degraded && <><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /><span className="text-[11px] font-semibold text-amber-700">Trained with warnings · {chunkCount.toLocaleString()} chunks{factCount > 0 ? ` · ${factCount} facts` : ''}</span></>}
                    {isDone && !degraded && <><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /><span className="text-[11px] font-semibold text-green-700">Trained · {chunkCount.toLocaleString()} chunks{factCount > 0 ? ` · ${factCount} facts` : ''}</span></>}
                    {isFailed && !isDone && <><AlertCircle className="h-3.5 w-3.5 text-red-500" /><span className="text-[11px] font-semibold text-red-600" title={doc.status_detail ?? undefined}>Failed</span></>}
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
          reviewVersion={reviewVersion}
          onTrain={() => trainDocument(sheetDoc)}
          onOpenSearch={() => { setSearchTarget({ documentId: sheetDoc.id, title: sheetDoc.title }); setSearchState(EMPTY_SEARCH_STATE); setSearchOpen(true) }}
          onClose={() => setSheetDoc(null)}
        />
      )}

      {/* ── Document search sheet ────────────────────────────────── */}
      {searchOpen && searchTarget && (
        <SearchSheet
          target={searchTarget}
          state={searchState}
          onSearch={(question) => runSearch(searchTarget.documentId, searchTarget.title, question)}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  )
}

/* ── Regression Suite Card ────────────────────────────────────
   Runs the fixed set of REGRESSION_QUESTIONS (src/lib/selfAssessment.ts)
   through /api/chat and records pass/fail + confidence per question. */
function RegressionSuiteCard({ lastRun, live, open, onToggle, onRun }: {
  lastRun: SelfAssessmentRun | null
  live: {
    status: 'idle' | 'running' | 'done' | 'error'
    message: string
    results: RegressionResultRow[]
    summary: { total: number; passed: number; accuracy: number; avgConfidence: number } | null
  }
  open: boolean
  onToggle: () => void
  onRun: () => void
}) {
  const isRunning = live.status === 'running'
  const results = live.results.length || live.status !== 'idle' ? live.results : (lastRun?.results ?? [])
  const summary = live.summary ?? (lastRun ? {
    total: lastRun.total_questions, passed: lastRun.passed,
    accuracy: lastRun.accuracy, avgConfidence: lastRun.avg_confidence,
  } : null)
  const total = REGRESSION_QUESTION_COUNT

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50">
            <ClipboardCheck className="h-4 w-4 text-gray-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Regression Suite</p>
            <p className="text-[11px] text-gray-400">
              {summary
                ? `Last run: ${summary.passed}/${summary.total} passed · avg confidence ${summary.avgConfidence}%`
                : `${total} representative questions — not run yet`}
              {lastRun && !live.summary && ` · ${formatDate(lastRun.created_at)}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {summary && (
            <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', performanceLabel(summary.accuracy).color)}>
              {summary.accuracy}% {performanceLabel(summary.accuracy).label}
            </span>
          )}
          <button
            onClick={onRun}
            disabled={isRunning}
            className="flex items-center gap-2 rounded-xl bg-brand px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-50">
            {isRunning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            {isRunning ? 'Running…' : 'Run Suite'}
          </button>
          {results.length > 0 && (
            <button
              onClick={onToggle}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-500 transition hover:bg-gray-100">
              {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {isRunning && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1.5">
            <RefreshCw className="h-3 w-3 animate-spin text-brand" />
            <span className="text-[11px] font-semibold text-brand">{results.length}/{total}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${(results.length / total) * 100}%` }} />
          </div>
          <p className="mt-1 truncate text-[10px] text-gray-400">{live.message}</p>
        </div>
      )}

      {live.status === 'error' && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-red-500" />
          <p className="text-xs text-red-600">{live.message || 'Regression run failed.'}</p>
        </div>
      )}

      {open && results.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          {results.map(r => (
            <div key={r.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-gray-800">{r.query}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wider text-gray-400">{r.category.replace(/_/g, ' ')}</p>
                </div>
                <span className={cn(
                  'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                  r.passed ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700',
                )}>
                  {r.passed ? 'PASS' : 'FAIL'}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-500">{r.reason}</p>
              <p className="mt-1 text-[10px] text-gray-400">
                Confidence {r.confidenceScore}% ({r.confidenceLevel}) · {r.citationCount} citation{r.citationCount === 1 ? '' : 's'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* Wraps every occurrence of any keyword in `text` with a <mark> highlight,
   so the user can see exactly which words anchored this passage to the question. */
function highlightText(text: string, keywords: string[]) {
  if (!keywords.length) return text
  const escaped = keywords
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = `(${escaped.join('|')})`
  const parts = text.split(new RegExp(pattern, 'gi'))
  const test = new RegExp(`^${pattern}$`, 'i')
  return parts.map((part, i) =>
    part && test.test(part)
      ? <mark key={i} className="rounded bg-amber-200 px-0.5 text-gray-900">{part}</mark>
      : <span key={i}>{part}</span>
  )
}

/* ── Document Search Sheet ───────────────────────────────────── */
function SearchSheet({
  target, state, onSearch, onClose,
}: {
  target: { documentId: string | null; title: string }
  state: SearchState
  onSearch: (question: string) => void
  onClose: () => void
}) {
  const isRunning = state.status === 'running'
  const isDone    = state.status === 'done'
  const isFailed  = state.status === 'error'
  const [question, setQuestion] = useState('')
  const [openDocs, setOpenDocs] = useState<Record<string, boolean>>({})

  function submit() {
    const q = question.trim()
    if (!q || isRunning) return
    onSearch(q)
  }

  const totalExcerpts = state.documents.reduce((a, d) => a + d.excerpts.length, 0)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-gray-200 bg-white shadow-2xl">
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-gray-300" />

        <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-4">
          <div className="min-w-0">
            <p className="truncate font-bold text-gray-900">Document Search</p>
            <p className="mt-0.5 truncate text-xs text-gray-400">{target.title}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Question input */}
        <div className="mx-5 flex items-center gap-2">
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            placeholder="Ask a question…"
            className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-800 outline-none focus:border-brand"
          />
          <button
            onClick={submit}
            disabled={isRunning || !question.trim()}
            className="flex items-center gap-2 rounded-xl bg-brand px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-50">
            {isRunning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search
          </button>
        </div>
        <p className="mx-5 mt-1.5 text-[11px] text-gray-400">
          Searches every chunk of every relevant document and returns verbatim excerpts — no AI-generated answers.
        </p>

        {isFailed && (
          <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-red-800">Search failed</p>
              <p className="text-xs text-red-600">{state.message || 'An error occurred.'}</p>
            </div>
          </div>
        )}

        {isDone && (
          <div className="mx-5 mt-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-600">
              <span className="font-semibold text-gray-800">{state.question}</span>
            </p>
            {state.keywords.length > 0 && (
              <p className="mt-1 text-[11px] text-gray-400">
                Matched on: {state.keywords.join(', ')}
              </p>
            )}
            <p className="mt-1 text-[11px] text-gray-400">
              {state.documents.length} document{state.documents.length === 1 ? '' : 's'}, {totalExcerpts} matching passage{totalExcerpts === 1 ? '' : 's'}
            </p>
          </div>
        )}

        {/* Direct answer — from validated, document-extracted figures */}
        {isDone && state.facts.length > 0 && (
          <div className="mx-5 mt-3 overflow-hidden rounded-xl border border-green-200 bg-green-50">
            <div className="px-4 pt-3">
              <p className="text-xs font-bold uppercase tracking-wider text-green-700">Direct Answer</p>
              <p className="mt-0.5 text-[11px] text-green-600">
                Figures extracted directly from the source document tables — not AI-generated.
              </p>
            </div>
            <div className="overflow-x-auto px-4 pb-3 pt-2">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-green-600">
                    <th className="py-1 pr-3">Year</th>
                    <th className="py-1 pr-3">Entity</th>
                    <th className="py-1 pr-3">Metric</th>
                    <th className="py-1 pr-3">Value</th>
                    <th className="py-1">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {state.facts.map((f, i) => (
                    <tr key={i} className="border-t border-green-100">
                      <td className="py-1.5 pr-3 font-semibold text-gray-800">{f.fiscalYear ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-gray-700">{f.entity}</td>
                      <td className="py-1.5 pr-3 text-gray-700">{f.metric.replace(/_/g, ' ')}</td>
                      <td className="py-1.5 pr-3 font-semibold text-gray-900">{f.value.toLocaleString()} {f.unit}</td>
                      <td className="py-1.5 text-[11px] text-gray-500">
                        {f.documentTitle}{f.pageNumber != null ? `, p.${f.pageNumber}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Results — grouped by document */}
        {isDone && state.documents.length === 0 && state.facts.length === 0 && (
          <div className="mx-5 mb-5 mt-3 rounded-xl border border-gray-200 bg-white px-4 py-6 text-center">
            <p className="text-sm font-medium text-gray-500">No matching passages found.</p>
            <p className="mt-1 text-xs text-gray-400">Try different wording, or include a year, ministry, or document name.</p>
          </div>
        )}

        {isDone && state.documents.length > 0 && (
          <div className="mx-5 mb-5 mt-3 space-y-2">
            {state.documents.map(doc => {
              const open = openDocs[doc.documentId] ?? true
              return (
                <div key={doc.documentId} className="rounded-xl border border-gray-200 bg-white">
                  <button
                    onClick={() => setOpenDocs(prev => ({ ...prev, [doc.documentId]: !open }))}
                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                      <span className="truncate text-xs font-bold text-gray-800">{doc.title}</span>
                      <span className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                        {doc.excerpts.length}
                      </span>
                    </div>
                    {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
                  </button>
                  {open && (
                    <div className="space-y-2 border-t border-gray-200 p-3">
                      {doc.excerpts.map((ex, i) => (
                        <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                            <Quote className="h-3 w-3 text-gray-400" />
                            <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                              Verbatim from source
                            </span>
                            {ex.pageNumber != null && (
                              <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                                Page {ex.pageNumber}
                              </span>
                            )}
                            {ex.sectionTitle && (
                              <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                                {ex.sectionTitle}
                              </span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap text-xs text-gray-700">{highlightText(ex.text, state.keywords)}</p>
                          <p className="mt-1.5 text-[10px] font-medium text-gray-400">
                            Source: {doc.title}{ex.pageNumber != null ? `, page ${ex.pageNumber}` : ''}{ex.sectionTitle ? ` — ${ex.sectionTitle}` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* AI review — automatically grades the Direct Answer + excerpts above
            against the question and records the verdict as performance. */}
        {isDone && state.review && (
          <div className={cn(
            'mx-5 mb-5 mt-1 flex items-start gap-2.5 rounded-xl border p-3',
            state.review.verdict === 'correct'
              ? 'border-green-200 bg-green-50'
              : 'border-red-200 bg-red-50',
          )}>
            <Sparkles className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', state.review.verdict === 'correct' ? 'text-green-600' : 'text-red-500')} />
            <div className="min-w-0">
              <p className={cn('text-xs font-semibold', state.review.verdict === 'correct' ? 'text-green-700' : 'text-red-700')}>
                AI review: {state.review.verdict === 'correct' ? 'Correct' : 'Incorrect / Incomplete'}
              </p>
              {state.review.reasoning && (
                <p className="mt-0.5 text-[11px] text-gray-600">{state.review.reasoning}</p>
              )}
            </div>
          </div>
        )}

        {!isDone && !isFailed && !isRunning && (
          <div className="h-5" />
        )}
      </div>
    </>
  )
}

/* ── Detail Sheet ────────────────────────────────────────────── */
function DetailSheet({
  doc, state, reviewVersion, onTrain, onOpenSearch, onClose,
}: {
  doc: TrainingDoc
  state: TrainState
  reviewVersion: number
  onTrain: () => void
  onOpenSearch: () => void
  onClose: () => void
}) {
  const isRunning  = state.status === 'running'
  const isDone     = state.status === 'done' || (state.status === 'idle' && doc.chunkCount > 0)
  const isFailed   = state.status === 'error' || (state.status === 'idle' && doc.status === 'failed')
  const degraded   = isDone && isDegraded(doc, state.status)
  const chunkCount = state.status === 'done' ? state.chunks : doc.chunkCount
  const factCount  = doc.financialFactCount + doc.documentFactCount

  const [logOpen, setLogOpen] = useState(true)
  const [docPerf, setDocPerf] = useState<Performance | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/search-reviews?documentId=${doc.id}`)
      .then(res => res.json())
      .then((data: Performance) => { if (!cancelled && data.total > 0) setDocPerf(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [doc.id, reviewVersion])

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
          {isDone && factCount > 0 && (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
              {factCount.toLocaleString()} fact{factCount === 1 ? '' : 's'} extracted
            </span>
          )}
          {doc.lastTrainedAt && (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-400">
              Last trained {new Date(doc.lastTrainedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
          {docPerf && (
            <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', performanceLabel(docPerf.accuracy).color)}>
              {docPerf.accuracy}% performance · {docPerf.correct}/{docPerf.total} reviewed
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
            {isDone && degraded && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">Trained with warnings</p>
                  <p className="text-xs text-amber-700">{doc.status_detail ?? 'Some extraction steps did not complete — the document still has partial data.'}</p>
                </div>
              </div>
            )}
            {isDone && !degraded && (
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
                  <p className="text-xs text-red-600">{state.message || doc.status_detail || 'An error occurred. Try retraining.'}</p>
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

        {/* Processing warnings — persisted, survives a page reload (unlike
            the live-only Training Log below, which is empty until the next
            run). Each entry is one degraded step from the most recent run. */}
        {!isRunning && (doc.processing_warnings?.length ?? 0) > 0 && (
          <div className="mx-5 mt-3 rounded-xl border border-amber-200 bg-amber-50/60">
            <div className="flex items-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wider text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              Processing Warnings
            </div>
            <div className="border-t border-amber-200/60 px-4 pb-3 pt-2 space-y-1.5">
              {doc.processing_warnings!.map((w, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                  <p className="text-xs text-amber-800">
                    <span className="font-semibold">{WARNING_STEP_LABELS[w.step] ?? w.step}:</span> {w.message}
                  </p>
                </div>
              ))}
            </div>
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
              onClick={onOpenSearch}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50">
              <Search className="h-4 w-4" />
              Search this document
            </button>
          )}
        </div>
      </div>
    </>
  )
}
