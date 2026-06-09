'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/dashboards/executive',      label: 'Executive',       short: 'Exec'   },
  { href: '/dashboards/sales',          label: 'Sales',           short: 'Sales'  },
  { href: '/dashboards/marketing',      label: 'Marketing',       short: 'Mktg'   },
  { href: '/dashboards/client-service', label: 'Client Service',  short: 'Client' },
  { href: '/dashboards/development',    label: 'Development',     short: 'Dev'    },
  { href: '/dashboards/finance',        label: 'Finance',         short: 'Fin'    },
  { href: '/dashboards/hr',             label: 'HR',              short: 'HR'     },
  { href: '/dashboards/communications', label: 'Communications',  short: 'Comms'  },
]

interface Props {
  title: string
  description: string
  lastUpdated: string
  children: React.ReactNode
}

export default function DashboardShell({ title, description, lastUpdated, children }: Props) {
  const pathname = usePathname()
  const router   = useRouter()

  // Prefetch all dashboard tabs on mount so switching is instant
  useEffect(() => {
    TABS.forEach(tab => router.prefetch(tab.href))
  }, [router])

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        </div>
        <span className="shrink-0 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-[11px] font-medium text-gray-400 shadow-sm">
          Updated {lastUpdated}
        </span>
      </div>

      {/* ── Dashboard tab bar ──────────────────────────────────── */}
      <div className="flex gap-0.5 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-1 shadow-sm no-scrollbar">
        {TABS.map(tab => {
          const active = pathname === tab.href
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onMouseEnter={() => router.prefetch(tab.href)}
              className={cn(
                'shrink-0 rounded-xl px-3.5 py-2 text-xs font-semibold transition whitespace-nowrap',
                active
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
              )}
            >
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.short}</span>
            </Link>
          )
        })}
      </div>

      {children}
    </div>
  )
}
