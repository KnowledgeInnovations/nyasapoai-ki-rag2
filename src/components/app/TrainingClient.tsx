'use client'

import { useState, useRef } from 'react'
import { Brain, CheckCircle2, AlertCircle, Clock, RefreshCw, Zap, FileText, ChevronDown, ChevronUp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { TrainingDoc } from '@/app/(app)/training/page'

type TrainStatus = 'idle' | 'running' | 'done' | 'error'

interface TrainState {
  status:   TrainStatus
  message:  string
  progress: number
  chunks:   number
  log:      string[]
}

function ext(source: string) {
  return source.split('.').pop()?.toUpperCase() ?? 'FILE'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const DEPT_LABELS: Record<string, string> = {
  contracts:    'Contracts',
  'site-reports': 'Site Reports',
  finance:      'Finance',
  legal:        'Legal',
  'design-plans': 'Design & Plans',
  'board-reports': 'Board Reports',
  general:      'General',
}

export default function TrainingClient({ docs, trainedCount, untrainedCount }: {
  docs: TrainingDoc[]
  trainedCount: number
  untrainedCount: number
}) {
  const router = useRouter()
  const [states, setStates] = useState<Record<string, TrainState>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const abortRefs = useRef<Record<string, AbortController>>({})

  function getState(id: string): TrainState {
    return states[id] ?? { status: 'idle', message: '', progress: 0, chunks: 0, log: [] }
  }

  function setState(id: string, update: Partial<TrainState> | ((prev: TrainState) => Partial<TrainState>)) {
    setStates(prev => {
      const current = prev[id] ?? { status: 'idle', message: '', progress: 0, chunks: 0, log: [] }
      const resolved = typeof update === 'function' ? update(current) : update
      return { ...prev, [id]: { ...current, ...resolved } }
    })
  }

  async function trainDocument(doc: TrainingDoc) {
    const abort = new AbortController()
    abortRefs.current[doc.id] = abort

    setState(doc.id, { status: 'running', message: 'Starting…', progress: 0, chunks: 0, log: [] })
    setExpanded(prev => ({ ...prev, [doc.id]: true }))

    // Track final status in a local variable to avoid stale-closure issues with React state
    let finalStatus: TrainStatus = 'running'

    try {
      const res = await fetch(`/api/documents/${doc.id}/train`, {
        method: 'POST',
        signal: abort.signal,
      })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)

      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let   buf     = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as {
              stage: string; message: string; progress: number; chunkCount?: number
            }
            const evtStatus: TrainStatus =
              event.stage === 'complete' ? 'done' :
              event.stage === 'error'    ? 'error' : 'running'
            finalStatus = evtStatus
            setState(doc.id, prev => ({
              status:   evtStatus,
              message:  event.message,
              progress: Math.max(event.progress, 0),
              chunks:   event.chunkCount ?? prev.chunks,
              log:      [...(prev.log ?? []), event.message],
            }))
          } catch {}
        }
      }

      if (finalStatus === 'done') router.refresh()
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        finalStatus = 'error'
        setState(doc.id, { status: 'error', message: (err as Error).message })
      }
    }
  }

  function trainAll() {
    const untrained = docs.filter(d => getState(d.id).status === 'idle' && d.chunkCount === 0)
    for (const d of untrained) trainDocument(d)
  }

  const totalChunks = docs.reduce((a, d) => a + d.chunkCount, 0)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">AI Training</h1>
          <p className="mt-1 text-sm text-gray-500">
            Train the AI on each document so it can answer questions from its contents.
            Retrain whenever a document has been replaced with a newer version.
          </p>
        </div>
        {untrainedCount > 0 && (
          <button
            onClick={trainAll}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark">
            <Zap className="h-4 w-4" />
            Train All Untrained ({untrainedCount})
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-3xl font-black text-gray-900">{docs.length}</p>
          <p className="mt-1 text-sm font-medium text-gray-600">Total Documents</p>
        </div>
        <div className="rounded-2xl border border-green-200 bg-green-50 p-5 shadow-sm">
          <p className="text-3xl font-black text-green-700">{trainedCount}</p>
          <p className="mt-1 text-sm font-medium text-green-600">Trained</p>
          <p className="mt-0.5 text-xs text-green-500">{totalChunks.toLocaleString()} knowledge chunks</p>
        </div>
        <div className={cn('rounded-2xl border p-5 shadow-sm', untrainedCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white')}>
          <p className={cn('text-3xl font-black', untrainedCount > 0 ? 'text-amber-700' : 'text-gray-400')}>{untrainedCount}</p>
          <p className={cn('mt-1 text-sm font-medium', untrainedCount > 0 ? 'text-amber-600' : 'text-gray-500')}>Needs Training</p>
        </div>
      </div>

      {/* Document list */}
      {docs.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white p-12 text-center">
          <Brain className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-500">No documents uploaded yet</p>
          <p className="mt-1 text-xs text-gray-400">Upload documents in the Documents section first.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 bg-gray-50 px-5 py-3">
            <div className="grid grid-cols-[1fr_120px_100px_140px_160px] gap-4 text-xs font-semibold text-gray-500">
              <span>Document</span>
              <span>Category</span>
              <span>Format</span>
              <span>Training Status</span>
              <span>Action</span>
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            {docs.map(doc => {
              const s    = getState(doc.id)
              const isRunning = s.status === 'running'
              const isDone    = s.status === 'done' || (s.status === 'idle' && doc.chunkCount > 0)
              const isFailed  = s.status === 'error' || (s.status === 'idle' && doc.status === 'failed')
              const chunkCount = s.status === 'done' ? s.chunks : doc.chunkCount
              const isExpanded = expanded[doc.id]

              return (
                <div key={doc.id}>
                  <div className={cn('grid grid-cols-[1fr_120px_100px_140px_160px] items-center gap-4 px-5 py-4', isRunning && 'bg-brand-light/30')}>

                    {/* Name */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', isDone ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200')}>
                        <FileText className={cn('h-4 w-4', isDone ? 'text-green-500' : 'text-gray-400')} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">{doc.title}</p>
                        <p className="truncate text-[11px] text-gray-400">{doc.source}</p>
                      </div>
                    </div>

                    {/* Category */}
                    <span className="truncate text-xs text-gray-500">
                      {doc.department ? (DEPT_LABELS[doc.department] ?? doc.department) : 'Uncategorised'}
                    </span>

                    {/* Format */}
                    <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500 w-fit">
                      {ext(doc.source)}
                    </span>

                    {/* Status */}
                    <div>
                      {isRunning && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin text-brand" />
                            <span className="text-xs font-semibold text-brand">Training…</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                            <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${s.progress}%` }} />
                          </div>
                          <p className="text-[10px] text-gray-400">{s.progress}%</p>
                        </div>
                      )}
                      {!isRunning && isDone && (
                        <div>
                          <div className="flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            <span className="text-xs font-semibold text-green-700">Trained</span>
                          </div>
                          <p className="text-[10px] text-gray-400">{chunkCount.toLocaleString()} chunks</p>
                          {doc.lastTrainedAt && (
                            <p className="text-[10px] text-gray-400">{formatDate(doc.lastTrainedAt)}</p>
                          )}
                        </div>
                      )}
                      {!isRunning && isFailed && (
                        <div className="flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                          <span className="text-xs font-semibold text-red-600">Failed</span>
                        </div>
                      )}
                      {!isRunning && !isDone && !isFailed && (
                        <div className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-amber-400" />
                          <span className="text-xs font-semibold text-amber-600">Not Trained</span>
                        </div>
                      )}
                    </div>

                    {/* Action */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => trainDocument(doc)}
                        disabled={isRunning}
                        className={cn(
                          'flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition disabled:opacity-50',
                          isDone
                            ? 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                            : 'bg-brand text-white shadow-sm hover:bg-brand-dark'
                        )}>
                        <Brain className="h-3.5 w-3.5" />
                        {isRunning ? 'Training…' : isDone ? 'Retrain' : 'Train'}
                      </button>
                      {s.log.length > 0 && (
                        <button
                          onClick={() => setExpanded(p => ({ ...p, [doc.id]: !p[doc.id] }))}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition">
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Training log */}
                  {isExpanded && s.log.length > 0 && (
                    <div className="border-t border-gray-100 bg-gray-50 px-5 py-3">
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Training Log</p>
                      <div className="space-y-1">
                        {s.log.map((line, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand/50" />
                            <p className="text-xs text-gray-600">{line}</p>
                          </div>
                        ))}
                      </div>
                      {s.status === 'done' && (
                        <p className="mt-2 text-xs font-semibold text-green-600">
                          ✓ AI is now trained on this document
                        </p>
                      )}
                      {s.status === 'error' && (
                        <p className="mt-2 text-xs font-semibold text-red-600">
                          Error: {s.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
