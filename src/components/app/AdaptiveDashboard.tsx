'use client'

import { useEffect, useState } from 'react'
import { Search, Pin, PinOff, RefreshCw, Sparkles, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SENTIMENT_CONFIG, type Sentiment } from './DashboardWidgets'
import DashboardInsightsGroup from './DashboardInsightsGroup'

interface DashboardTheme {
  title: string
  description: string
  insights: { label: string; question: string }[]
}

interface PinnedInsight {
  id: string
  label: string
  question: string
  insight: string
  sentiment: Sentiment
  sources: string[]
  created_at: string
}

interface AskResult {
  question: string
  label: string
  insight: string
  sentiment: Sentiment
  sources: string[]
  noData?: boolean
}

// Shared card shell — the ask-anything result and pinned cards use the same
// visual language as DashboardInsightsGroup's theme cards, so the whole
// dashboard reads as one system rather than three different card styles.
function InsightCardShell({
  label, insight, sentiment, sources, noData, action,
}: {
  label: string; insight: string; sentiment: Sentiment; sources: string[]; noData?: boolean
  action?: React.ReactNode
}) {
  const cfg = SENTIMENT_CONFIG[sentiment]
  return (
    <div className={cn('border p-5 shadow-sm', cfg.border, cfg.bg)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">{label}</p>
        {action}
      </div>
      {!noData && (
        <div className="mt-2 inline-flex items-center gap-1.5">
          <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', cfg.badge)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
            {cfg.text}
          </span>
        </div>
      )}
      <p className="mt-2 text-sm leading-relaxed text-gray-800">{insight}</p>
      {sources.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {sources.map(src => (
            <span key={src} className="flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] text-gray-400 shadow-sm">
              <FileText className="h-2.5 w-2.5" />{src}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function AskBox({ onPinned }: { onPinned: (pin: PinnedInsight) => void }) {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AskResult | null>(null)
  const [pinning, setPinning] = useState(false)
  const [pinned, setPinned] = useState(false)

  async function ask() {
    const q = question.trim()
    if (!q || loading) return
    setLoading(true)
    setResult(null)
    setPinned(false)
    try {
      const res = await fetch('/api/dashboard/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, label: 'Your question' }),
      })
      const data = await res.json()
      setResult({ question: q, label: data.label || 'Your question', insight: data.insight, sentiment: data.sentiment, sources: data.sources ?? [], noData: data.noData })
    } catch {
      setResult({ question: q, label: 'Your question', insight: 'Could not get an answer — please try again.', sentiment: 'neutral', sources: [] })
    } finally {
      setLoading(false)
    }
  }

  async function pin() {
    if (!result || pinning) return
    setPinning(true)
    try {
      const res = await fetch('/api/dashboard/pinned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: result.question.length > 40 ? result.question.slice(0, 40) + '…' : result.question, question: result.question, insight: result.insight, sentiment: result.sentiment, sources: result.sources }),
      })
      const data = await res.json()
      if (data.pinned) { onPinned(data.pinned); setPinned(true) }
    } finally {
      setPinning(false)
    }
  }

  return (
    <div className="border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-brand" />
        <p className="text-sm font-bold text-gray-800">Ask anything about your documents</p>
      </div>
      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" />
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') ask() }}
            placeholder="e.g. Which of our properties has the highest expected ROI?"
            className="w-full border border-gray-200 py-2.5 pl-9 pr-3 text-sm focus:border-brand focus:outline-none"
          />
        </div>
        <button
          onClick={ask}
          disabled={loading || !question.trim()}
          className="shrink-0 bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ask'}
        </button>
      </div>

      {result && (
        <div className="mt-4">
          <InsightCardShell
            label={result.label}
            insight={result.insight}
            sentiment={result.sentiment}
            sources={result.sources}
            noData={result.noData}
            action={
              !result.noData && (
                <button
                  onClick={pin}
                  disabled={pinning || pinned}
                  className="flex items-center gap-1 border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-500 transition hover:bg-gray-50 disabled:opacity-50"
                  title={pinned ? 'Pinned' : 'Pin to dashboard'}
                >
                  <Pin className="h-3 w-3" /> {pinned ? 'Pinned' : 'Pin'}
                </button>
              )
            }
          />
        </div>
      )}
    </div>
  )
}

export default function AdaptiveDashboard() {
  const [themes, setThemes] = useState<DashboardTheme[] | null>(null)
  const [themesError, setThemesError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pinned, setPinned] = useState<PinnedInsight[] | null>(null)

  function loadThemes(refresh = false) {
    setThemesError(false)
    if (refresh) setRefreshing(true)
    fetch(`/api/dashboard/themes${refresh ? '?refresh=1' : ''}`)
      .then(r => r.json())
      .then(d => setThemes(d.themes ?? []))
      .catch(() => setThemesError(true))
      .finally(() => setRefreshing(false))
  }

  useEffect(() => {
    loadThemes(false)
    fetch('/api/dashboard/pinned').then(r => r.json()).then(d => setPinned(d.pinned ?? [])).catch(() => setPinned([]))
  }, [])

  async function unpin(id: string) {
    setPinned(prev => (prev ?? []).filter(p => p.id !== id))
    try { await fetch(`/api/dashboard/pinned/${id}`, { method: 'DELETE' }) } catch { /* card already removed optimistically */ }
  }

  return (
    <div className="space-y-5">
      <AskBox onPinned={p => setPinned(prev => [p, ...(prev ?? [])])} />

      {pinned != null && pinned.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Pinned</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pinned.map(p => (
              <InsightCardShell
                key={p.id}
                label={p.label}
                insight={p.insight}
                sentiment={p.sentiment}
                sources={p.sources}
                action={
                  <button onClick={() => unpin(p.id)} className="flex h-6 w-6 items-center justify-center text-gray-300 transition hover:bg-gray-100 hover:text-red-500" title="Unpin">
                    <PinOff className="h-3 w-3" />
                  </button>
                }
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
          {themes === null ? 'Analysing your documents…' : 'Discovered from your documents'}
        </p>
        {themes !== null && (
          <button
            onClick={() => loadThemes(true)}
            disabled={refreshing}
            className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 transition hover:text-brand disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} /> Refresh
          </button>
        )}
      </div>

      {themesError && (
        <div className="border border-gray-200 bg-white p-5 text-center text-sm text-gray-400">
          Could not load dashboard insights. <button onClick={() => loadThemes(true)} className="text-brand underline">Retry</button>
        </div>
      )}

      {themes === null && !themesError && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="border border-gray-200 bg-white p-5">
              <div className="h-3 w-24 animate-pulse rounded bg-gray-200" />
              <div className="mt-3 space-y-2">
                <div className="h-3 w-full animate-pulse rounded bg-gray-100" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      )}

      {themes !== null && themes.length === 0 && !themesError && (
        <div className="border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center">
          <p className="text-sm font-medium text-gray-500">Upload documents to see AI-discovered insights here.</p>
          <p className="mt-1 text-xs text-gray-400">The dashboard organizes itself around whatever your documents actually cover.</p>
        </div>
      )}

      {themes?.map(theme => (
        <div key={theme.title}>
          <p className="font-editorial text-base text-gray-900">{theme.title}</p>
          <p className="mb-2 text-xs text-gray-400">{theme.description}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DashboardInsightsGroup insights={theme.insights} />
          </div>
        </div>
      ))}
    </div>
  )
}
