'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

type Sentiment = 'positive' | 'negative' | 'caution' | 'neutral'

interface InsightData {
  label: string
  insight: string
  sentiment: Sentiment
  sources: string[]
  noData?: boolean
}

export interface InsightConfig {
  question: string
  label: string
}

interface Props {
  insights: InsightConfig[]
}

const SENTIMENT_CONFIG: Record<Sentiment, { dot: string; badge: string; border: string; bg: string; text: string }> = {
  positive: { dot: 'bg-green-500',  badge: 'bg-green-50 text-green-700 border-green-200',  border: 'border-green-200', bg: 'bg-green-50/40',  text: 'Positive' },
  negative: { dot: 'bg-red-500',    badge: 'bg-red-50 text-red-700 border-red-200',        border: 'border-red-200',   bg: 'bg-red-50/40',    text: 'Needs Attention' },
  caution:  { dot: 'bg-amber-500',  badge: 'bg-amber-50 text-amber-700 border-amber-200',  border: 'border-amber-200', bg: 'bg-amber-50/40',  text: 'Caution' },
  neutral:  { dot: 'bg-gray-400',   badge: 'bg-gray-50 text-gray-600 border-gray-200',     border: 'border-gray-200',  bg: 'bg-white',        text: 'Neutral' },
}

const CACHE_TTL = 15 * 60 * 1000

function getCached(key: string): InsightData[] | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const { data, ts }: { data: InsightData[]; ts: number } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) { sessionStorage.removeItem(key); return null }
    return data
  } catch { return null }
}

function setCached(key: string, data: InsightData[]) {
  try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })) } catch {}
}

function InsightCard({ data, loading, onRefresh }: { data?: InsightData; loading: boolean; onRefresh: () => void }) {
  const cfg = data ? SENTIMENT_CONFIG[data.sentiment] : SENTIMENT_CONFIG.neutral

  return (
    <div className={cn('rounded-2xl border p-5 shadow-sm transition', loading ? 'border-gray-200 bg-white' : cfg.border, !loading && data && cfg.bg)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">{data?.label ?? <span className="h-3 w-24 animate-pulse rounded bg-gray-200 inline-block" />}</p>
        {data && (
          <button onClick={onRefresh} className="flex h-6 w-6 items-center justify-center rounded-lg text-gray-300 transition hover:bg-gray-100 hover:text-gray-500" title="Refresh">
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
      </div>

      {loading && (
        <div className="mt-3 space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-gray-100" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-gray-100" />
          <div className="h-3 w-4/6 animate-pulse rounded bg-gray-100" />
        </div>
      )}

      {!loading && data && (
        <>
          {!data.noData && (
            <div className="mt-2 inline-flex items-center gap-1.5">
              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', cfg.badge)}>
                <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                {cfg.text}
              </span>
            </div>
          )}
          <p className="mt-2 text-sm leading-relaxed text-gray-800">{data.insight}</p>
          {data.sources.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.sources.map(src => (
                <span key={src} className="flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] text-gray-400 shadow-sm">
                  <FileText className="h-2.5 w-2.5" />{src}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function DashboardInsightsGroup({ insights }: Props) {
  const [data,    setData]    = useState<InsightData[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  const cacheKey = `dash-batch:${insights.map(i => i.label).join('|')}`

  function load(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = getCached(cacheKey)
      if (cached) { setData(cached); setLoading(false); return }
    }
    setLoading(true)
    setError(false)
    fetch('/api/dashboard/insights-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: insights }),
    })
      .then(r => r.json())
      .then(d => { setData(d.insights); setCached(cacheKey, d.insights); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(false) }, [cacheKey])

  if (error) {
    return (
      <div className="col-span-3 rounded-2xl border border-gray-200 bg-white p-5 text-center text-sm text-gray-400">
        Could not load insights. <button onClick={() => load(true)} className="text-brand underline">Retry</button>
      </div>
    )
  }

  return (
    <>
      {insights.map((cfg, i) => (
        <InsightCard
          key={cfg.label}
          data={data?.[i]}
          loading={loading}
          onRefresh={() => load(true)}
        />
      ))}
    </>
  )
}
