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
    <div className="space-y-4">

      {/* ── Header — compact, two lines max ─────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-editorial truncate text-xl font-normal text-gray-900">{title}</h1>
          <p className="hidden truncate text-xs text-gray-500 sm:block">{description}</p>
        </div>
        <span className="shrink-0 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-400 shadow-sm">
          {lastUpdated}
        </span>
      </div>

      {/* ── Dashboard tab bar — scrollable, no-scrollbar ───────── */}
      <div className="flex gap-1 overflow-x-auto  border border-gray-200 bg-gray-50 p-1 no-scrollbar">
        {TABS.map(tab => {
          const active = pathname === tab.href
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onMouseEnter={() => router.prefetch(tab.href)}
              className={cn(
                'shrink-0  px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap transition',
                active
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-gray-500 hover:bg-white hover:text-gray-800'
              )}
            >
              {/* Show short label on small screens, full on md+ */}
              <span className="sm:hidden">{tab.short}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </Link>
          )
        })}
      </div>

      <div className="space-y-4">{children}</div>
    </div>
  )
}
