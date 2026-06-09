import Link from 'next/link'
import { FileText, MessageSquare, CheckCircle2, Clock } from 'lucide-react'
import type { CATEGORIES } from '@/lib/documentCategories'
import { cn } from '@/lib/utils'

// ── StatCard ───────────────────────────────────────────────────
export function StatCard({ icon: Icon, label, value, sub, live, color }: {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
  live?: boolean
  color: string
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div className={cn('inline-flex rounded-xl p-2', color)}>
          <Icon className="h-5 w-5" />
        </div>
        {live
          ? <span className="flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />Live
            </span>
          : <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-400">
              Integration
            </span>
        }
      </div>
      <p className="mt-4 text-3xl font-black text-gray-900">{value}</p>
      <p className="mt-0.5 text-sm font-medium text-gray-700">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

// ── StatusChip ─────────────────────────────────────────────────
export function StatusChip({ status }: { status: string }) {
  if (status === 'ready')
    return <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700"><CheckCircle2 className="h-3 w-3" />Ready</span>
  if (status === 'processing')
    return <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"><Clock className="h-3 w-3" />Processing</span>
  return <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">Failed</span>
}

// ── DocList ────────────────────────────────────────────────────
type DocRow = { id: string; title: string; department: string | null; status: string; created_at: string }
type CatEntry = (typeof CATEGORIES)[number]

export function DocList({ docs, cat, title, emptyText = 'No documents yet' }: {
  docs: DocRow[] | null
  cat: CatEntry | undefined
  title: string
  emptyText?: string
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div>
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <p className="mt-0.5 text-xs text-gray-400">{docs?.length ?? 0} documents</p>
        </div>
        <Link href="/documents" className="text-xs font-semibold text-brand hover:underline">View all →</Link>
      </div>
      {docs?.length ? (
        <ul className="divide-y divide-gray-100">
          {docs.map(doc => (
            <li key={doc.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                cat ? `${cat.bgColor} ${cat.borderColor}` : 'bg-gray-50 border-gray-200')}>
                {cat
                  ? <cat.icon className={cn('h-4 w-4', cat.textColor)} />
                  : <FileText className="h-4 w-4 text-gray-400" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-800">{doc.title}</p>
                <p className="text-[11px] text-gray-400">
                  {new Date(doc.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </p>
              </div>
              <StatusChip status={doc.status} />
            </li>
          ))}
        </ul>
      ) : (
        <DashEmpty icon={FileText} text={emptyText} sub="Upload documents to see them here" />
      )}
    </div>
  )
}

// ── QueryList ──────────────────────────────────────────────────
type ConvRow = { id: string; query: string; created_at: string; risks?: string[] }

export function QueryList({ convs }: { convs: ConvRow[] | null }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <h2 className="font-semibold text-gray-900">Recent AI Queries</h2>
        <p className="mt-0.5 text-xs text-gray-400">Latest questions asked in this workspace</p>
      </div>
      {convs?.length ? (
        <ul className="divide-y divide-gray-100">
          {convs.map(c => (
            <li key={c.id} className="flex items-start gap-3 px-5 py-3.5">
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-brand/50" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-gray-800">{c.query}</p>
                <p className="mt-0.5 text-[11px] text-gray-400">
                  {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              {(c.risks?.length ?? 0) > 0 && (
                <span className="mt-0.5 shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  {c.risks!.length} risk{c.risks!.length > 1 ? 's' : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <DashEmpty icon={MessageSquare} text="No queries yet" sub="Start asking questions in Ask AI" />
      )}
    </div>
  )
}

// ── PlaceholderCard ────────────────────────────────────────────
export function PlaceholderCard({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-5 text-center">
      <p className="text-sm font-semibold text-gray-400">{label}</p>
      <p className="mt-1 text-xs text-gray-300">Connect data source to enable</p>
    </div>
  )
}

// ── DashEmpty ──────────────────────────────────────────────────
export function DashEmpty({ icon: Icon, text, sub }: { icon: React.ElementType; text: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <Icon className="mb-2 h-8 w-8 text-gray-200" />
      <p className="text-sm font-medium text-gray-500">{text}</p>
      <p className="mt-1 text-xs text-gray-400">{sub}</p>
    </div>
  )
}
