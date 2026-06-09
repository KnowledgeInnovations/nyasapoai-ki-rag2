import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getMembership } from '@/lib/supabase/server'
import {
  Crown, TrendingUp, Megaphone, HeartHandshake,
  HardHat, Banknote, Users, Radio, ArrowRight,
} from 'lucide-react'

export const metadata: Metadata = { title: 'Dashboards - Knowledge Innovations' }

const ALLOWED_ROLES = ['admin', 'exco', 'senior_manager', 'senior', 'middle']

const DASHBOARDS = [
  {
    href:        '/dashboards/executive',
    label:       'Executive',
    description: 'Company-wide KPIs, sales performance, project status, and real-time alerts for leadership.',
    icon:        Crown,
    color:       'text-indigo-600 bg-indigo-50 border-indigo-200',
  },
  {
    href:        '/dashboards/sales',
    label:       'Sales',
    description: 'Leads, pipeline status, reservations, sales targets, and top-performing executives.',
    icon:        TrendingUp,
    color:       'text-amber-600 bg-amber-50 border-amber-200',
  },
  {
    href:        '/dashboards/marketing',
    label:       'Marketing',
    description: 'Campaign performance, lead generation metrics, ROI, and digital marketing analytics.',
    icon:        Megaphone,
    color:       'text-purple-600 bg-purple-50 border-purple-200',
  },
  {
    href:        '/dashboards/client-service',
    label:       'Client Service',
    description: 'Onboarding status, follow-up activities, payments, and customer satisfaction scores.',
    icon:        HeartHandshake,
    color:       'text-cyan-600 bg-cyan-50 border-cyan-200',
  },
  {
    href:        '/dashboards/development',
    label:       'Development',
    description: 'Project progress, construction milestones, contractor performance, and budget tracking.',
    icon:        HardHat,
    color:       'text-orange-600 bg-orange-50 border-orange-200',
  },
  {
    href:        '/dashboards/finance',
    label:       'Finance',
    description: 'Revenue collection, outstanding payments, cash flow, and financial risk indicators.',
    icon:        Banknote,
    color:       'text-green-600 bg-green-50 border-green-200',
  },
  {
    href:        '/dashboards/hr',
    label:       'HR',
    description: 'Headcount, recruitment, leave management, KPI tracking, and staff development.',
    icon:        Users,
    color:       'text-rose-600 bg-rose-50 border-rose-200',
  },
  {
    href:        '/dashboards/communications',
    label:       'Communications',
    description: 'Internal reach, email engagement, staff metrics, and announcement tracking.',
    icon:        Radio,
    color:       'text-blue-600 bg-blue-50 border-blue-200',
  },
]

export default async function DashboardsHubPage() {
  const membership = await getMembership()
  if (!membership || !ALLOWED_ROLES.includes(membership.role)) redirect('/ask')

  const role = membership.role
  const displayRole = role.replace(/_/g, ' ')

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dashboards</h1>
          <p className="mt-1 text-sm text-gray-500">
            Live analytics and performance metrics across every function.
          </p>
        </div>
        <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3.5 py-1.5 text-xs">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
          <span className="font-semibold capitalize text-green-700">{displayRole}</span>
          <span className="text-green-500">&middot; {DASHBOARDS.length} active</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {DASHBOARDS.map(d => (
          <Link
            key={d.href}
            href={d.href}
            className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-lg"
          >
            {/* Animated top bar on hover */}
            <div className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-brand to-gold transition-transform duration-300 group-hover:scale-x-100" />

            <div className={`mb-4 inline-flex w-fit rounded-xl border p-2.5 transition-transform duration-200 group-hover:scale-110 ${d.color}`}>
              <d.icon className="h-5 w-5" />
            </div>
            <p className="font-bold text-gray-900">{d.label}</p>
            <p className="mt-1.5 flex-1 text-xs leading-relaxed text-gray-500">{d.description}</p>
            <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-brand opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              Open dashboard <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
