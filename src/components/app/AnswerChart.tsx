'use client'

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts'
import { TrendingUp } from 'lucide-react'
import type { ChartData } from '@/types'

// Merges historical + projected points into rows recharts can plot as two
// lines — the last historical point is duplicated onto the projected line
// so the dashed segment connects continuously from the solid one.
function buildRows(data: ChartData) {
  const sorted = [...data.series].sort((a, b) => a.year - b.year)
  const firstProjectedIdx = sorted.findIndex(p => p.projected)
  return sorted.map((p, i) => {
    const row: { year: number; value?: number; projectedValue?: number } = { year: p.year }
    if (!p.projected) row.value = p.value
    if (p.projected) row.projectedValue = p.value
    if (firstProjectedIdx > 0 && i === firstProjectedIdx - 1) row.projectedValue = p.value
    return row
  })
}

export default function AnswerChart({ data }: { data: ChartData }) {
  if (!data?.series?.length) return null
  const rows = buildRows(data)
  const hasProjected = data.series.some(p => p.projected)

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-gray-700">
        <TrendingUp className="h-3.5 w-3.5 text-brand" /> {data.title}
        {data.unit && <span className="font-normal text-gray-400">({data.unit})</span>}
      </p>
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" width={56} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone" dataKey="value" name="Historical"
              stroke="#2029bd" strokeWidth={2} dot={{ r: 3 }} connectNulls
            />
            {hasProjected && (
              <Line
                type="monotone" dataKey="projectedValue" name="Projected (estimate)"
                stroke="#9ca3af" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
