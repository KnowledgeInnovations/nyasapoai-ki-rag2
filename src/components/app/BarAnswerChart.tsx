'use client'

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'
import { BarChart3 } from 'lucide-react'
import type { BarChartData } from '@/types'

// Brand-token bar fill, alternating with the gold accent so adjacent bars in
// a longer comparison stay visually distinct without a legend.
const COLORS = ['#2029bd', '#14caf4']

export default function BarAnswerChart({ data }: { data: BarChartData }) {
  if (!data?.data?.length) return null

  return (
    <div className="border border-gray-200 bg-white px-4 py-3.5 font-editorial-sans">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-gray-700">
        <BarChart3 className="h-3.5 w-3.5 text-brand" /> {data.title}
        {data.unit && <span className="font-normal text-gray-400">({data.unit})</span>}
      </p>
      <div className="w-full" style={{ height: Math.max(160, data.data.length * 34) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data.data}
            layout="vertical"
            margin={{ top: 4, right: 24, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <YAxis
              type="category" dataKey="label" tick={{ fontSize: 11 }} stroke="#9ca3af"
              width={140} tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 0, border: '1px solid #e5e7eb' }}
              formatter={(value: unknown) => [data.unit ? `${value}${data.unit}` : String(value ?? ''), data.title]}
            />
            <Bar dataKey="value" radius={0}>
              {data.data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
