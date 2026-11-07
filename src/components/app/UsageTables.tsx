'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

export interface TenantUsageRow {
  key: string
  label: string
  deleted: boolean
  calls: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd: number
  unpriced: number
}

export interface ModelUsageRow {
  model: string
  provider: string
  calls: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd: number
  unpriced: number
}

export interface PersonUsageRow {
  key: string
  /** Name, or email, or "Background job" — never a bare uuid. */
  label: string
  /** Which workspace they were acting in. */
  workspace: string
  /** True for work no person asked for: crons, retries, scheduled passes. */
  automated: boolean
  calls: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd: number
  unpriced: number
}

export interface OperationRow {
  operation: string
  calls: number
  cost: number
  priced: boolean
}

interface Props {
  tenants: TenantUsageRow[]
  models: ModelUsageRow[]
  people: PersonUsageRow[]
  operations: OperationRow[]
  totalCost: number
  days: number
}

type Tab = 'workspaces' | 'people' | 'models' | 'work'

const TABS: { id: Tab; label: string }[] = [
  { id: 'workspaces', label: 'By workspace' },
  { id: 'people',     label: 'By person' },
  { id: 'models',     label: 'By model' },
  { id: 'work',       label: 'By work type' },
]

/** What each operation actually is, in words the reader did not write. */
const WORK_LABELS: Record<string, string> = {
  chat:       'Answering questions',
  agentic:    'Agentic answering (tool calls)',
  rerank:     'Reranking search results',
  embed:      'Embedding text',
  extract:    'Extracting facts from documents',
  verify:     'Verifying answers',
  vision:     'Reading scanned pages',
  insight:    'Dashboard insights',
  profile:    'Profiling documents',
  heuristics: 'Answer heuristics',
  assessment: 'Self-assessment',
  search:     'Document search review',
  other:      'Other',
}

const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`
const fmtInt = (n: number) => n.toLocaleString('en-US')
const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n)

/**
 * A single-hue magnitude bar. One series, so no legend and no categorical
 * palette: the number beside it carries the value and the bar only conveys
 * proportion at a glance.
 */
function ShareBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0
  return (
    <div className="h-1.5 w-full bg-gray-100" role="presentation">
      <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
    </div>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={cn('px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500', right ? 'text-right' : 'text-left')}>
      {children}
    </th>
  )
}

function Td({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td className={cn('px-4 py-2.5 text-sm text-gray-700', right && 'text-right tabular-nums', mono && 'font-mono text-xs')}>
      {children}
    </td>
  )
}

export default function UsageTables({ tenants, models, people, operations, totalCost, days }: Props) {
  const [tab, setTab] = useState<Tab>('workspaces')

  const maxPersonCost = Math.max(0, ...people.map(p => p.costUsd))
  const maxTenantCost = Math.max(0, ...tenants.map(t => t.costUsd))
  const maxModelCost  = Math.max(0, ...models.map(m => m.costUsd))
  const maxWorkCost   = Math.max(0, ...operations.map(o => o.cost))

  const empty = tenants.length === 0

  return (
    <section className="overflow-hidden border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/60 px-6 py-3.5">
        <div className="flex border border-gray-200 bg-white">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={cn(
                'px-3.5 py-1.5 text-xs font-semibold transition',
                tab === t.id ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {fmtUsd(totalCost)} across {fmtInt(tenants.length)} workspace{tenants.length === 1 ? '' : 's'} · last {days} days
        </p>
      </div>

      {empty ? (
        <p className="px-6 py-10 text-center text-sm text-gray-500">
          No model calls recorded in this window.
          <span className="mt-1 block text-xs text-gray-400">
            Recording starts when the code that logs it is deployed — earlier usage cannot be recovered.
          </span>
        </p>
      ) : (
        <div className="overflow-x-auto">
          {tab === 'workspaces' && (
            <table className="w-full min-w-[46rem]">
              <thead className="border-b border-gray-100">
                <tr>
                  <Th>Workspace</Th>
                  <Th right>Calls</Th>
                  <Th right>Input</Th>
                  <Th right>Output</Th>
                  <Th right>Cached</Th>
                  <Th right>Cost</Th>
                  <Th>Share</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {tenants.map(t => (
                  <tr key={t.key} className="hover:bg-gray-50/60">
                    <Td>
                      <span className={cn('font-medium', t.deleted ? 'text-gray-400 italic' : 'text-gray-900')}>{t.label}</span>
                      {t.unpriced > 0 && (
                        <span className="ml-2 border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                          {fmtInt(t.unpriced)} unpriced
                        </span>
                      )}
                    </Td>
                    <Td right>{fmtInt(t.calls)}</Td>
                    <Td right>{compact(t.inputTokens)}</Td>
                    <Td right>{compact(t.outputTokens)}</Td>
                    <Td right>{compact(t.cachedTokens)}</Td>
                    <Td right><span className="font-semibold text-gray-900">{fmtUsd(t.costUsd)}</span></Td>
                    <td className="w-28 px-4 py-2.5"><ShareBar value={t.costUsd} max={maxTenantCost} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'people' && (
            <table className="w-full min-w-[48rem]">
              <thead className="border-b border-gray-100">
                <tr>
                  <Th>Person</Th>
                  <Th>Workspace</Th>
                  <Th right>Calls</Th>
                  <Th right>Input</Th>
                  <Th right>Output</Th>
                  <Th right>Cost</Th>
                  <Th>Share</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {people.map(p => (
                  <tr key={p.key} className="hover:bg-gray-50/60">
                    <Td>
                      <span className={cn('font-medium', p.automated ? 'text-gray-500 italic' : 'text-gray-900')}>
                        {p.label}
                      </span>
                      {p.automated && (
                        <span className="ml-2 border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                          automated
                        </span>
                      )}
                      {p.unpriced > 0 && (
                        <span className="ml-2 border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                          {fmtInt(p.unpriced)} unpriced
                        </span>
                      )}
                    </Td>
                    <Td>{p.workspace}</Td>
                    <Td right>{fmtInt(p.calls)}</Td>
                    <Td right>{compact(p.inputTokens)}</Td>
                    <Td right>{compact(p.outputTokens)}</Td>
                    <Td right><span className="font-semibold text-gray-900">{fmtUsd(p.costUsd)}</span></Td>
                    <td className="w-28 px-4 py-2.5"><ShareBar value={p.costUsd} max={maxPersonCost} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'models' && (
            <table className="w-full min-w-[44rem]">
              <thead className="border-b border-gray-100">
                <tr>
                  <Th>Model</Th>
                  <Th>Provider</Th>
                  <Th right>Calls</Th>
                  <Th right>Input</Th>
                  <Th right>Output</Th>
                  <Th right>Cost</Th>
                  <Th>Share</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {models.map(m => (
                  <tr key={m.model} className="hover:bg-gray-50/60">
                    <Td mono>{m.model}</Td>
                    <Td><span className="text-xs uppercase tracking-wide text-gray-500">{m.provider}</span></Td>
                    <Td right>{fmtInt(m.calls)}</Td>
                    <Td right>{compact(m.inputTokens)}</Td>
                    <Td right>{compact(m.outputTokens)}</Td>
                    <Td right>
                      {m.unpriced === m.calls
                        ? <span className="text-xs font-semibold text-amber-700">no rate set</span>
                        : <span className="font-semibold text-gray-900">{fmtUsd(m.costUsd)}</span>}
                    </Td>
                    <td className="w-28 px-4 py-2.5"><ShareBar value={m.costUsd} max={maxModelCost} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'work' && (
            <table className="w-full min-w-[34rem]">
              <thead className="border-b border-gray-100">
                <tr>
                  <Th>What the models were doing</Th>
                  <Th right>Calls</Th>
                  <Th right>Cost</Th>
                  <Th>Share</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {operations.map(o => (
                  <tr key={o.operation} className="hover:bg-gray-50/60">
                    <Td>
                      <span className="text-gray-900">{WORK_LABELS[o.operation] ?? o.operation}</span>
                      <span className="ml-2 font-mono text-[11px] text-gray-400">{o.operation}</span>
                    </Td>
                    <Td right>{fmtInt(o.calls)}</Td>
                    <Td right>
                      <span className="font-semibold text-gray-900">{fmtUsd(o.cost)}</span>
                      {!o.priced && <span className="ml-1 text-[10px] text-amber-700">partial</span>}
                    </Td>
                    <td className="w-28 px-4 py-2.5"><ShareBar value={o.cost} max={maxWorkCost} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}
