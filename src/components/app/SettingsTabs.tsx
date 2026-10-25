'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { User, ShieldCheck, Building2, Users, Brain } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SettingsTab {
  href:  string
  label: string
  icon:  'profile' | 'security' | 'workspace' | 'users' | 'training'
}

// Named rather than passed as components, because the tab list is built in a
// server component and a React component is not serialisable across that
// boundary.
const ICONS = {
  profile:   User,
  security:  ShieldCheck,
  workspace: Building2,
  users:     Users,
  training:  Brain,
} as const

// One tab per route rather than client-side state, so Users and Training can
// each fetch their own data when opened instead of every Settings visit
// paying for a full chunk count and a membership list it may never show.
export default function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const pathname = usePathname()

  // Longest match wins: /settings is a prefix of every other tab's href, so
  // startsWith alone would light up Profile on all of them.
  const activeHref = tabs
    .filter(t => pathname === t.href || pathname.startsWith(`${t.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  return (
    <nav className="flex gap-1.5 overflow-x-auto pb-1 md:w-52 md:shrink-0 md:flex-col md:overflow-visible md:pb-0">
      {tabs.map(tab => {
        const Icon = ICONS[tab.icon]
        return (
          <Link key={tab.href} href={tab.href}
            className={cn(
              'flex shrink-0 items-center gap-2.5 whitespace-nowrap px-4 py-2.5 text-sm font-semibold transition',
              activeHref === tab.href
                ? 'bg-brand text-white shadow-md shadow-brand/20'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800',
            )}>
            <Icon className="h-4 w-4" />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
