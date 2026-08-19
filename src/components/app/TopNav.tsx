'use client'

import { useState } from 'react'
import { ChevronDown, LogOut, Settings, Menu, PanelLeftClose, PanelLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, usePathname } from 'next/navigation'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { cn } from '@/lib/utils'

interface Props {
  user: SupabaseUser
  onMenuOpen: () => void
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}

const pageTitles: Record<string, string> = {
  '/ask':                          'Ask AI',
  '/documents':                    'Documents',
  '/training':                     'AI Training',
  '/dashboards/executive':         'Executive Dashboard',
  '/dashboards/sales':             'Sales Dashboard',
  '/dashboards/marketing':         'Marketing Dashboard',
  '/dashboards/client-service':    'Client Service Dashboard',
  '/dashboards/development':       'Development Dashboard',
  '/dashboards/finance':           'Finance Dashboard',
  '/dashboards/hr':                'HR Dashboard',
  '/dashboards/communications':    'Communications Dashboard',
  '/dashboards':                   'Dashboards',
  '/settings':                     'Settings',
}

export default function AppTopNav({ user, onMenuOpen, sidebarCollapsed, onToggleSidebar }: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const supabase = createClient()

  async function signOut() {
    document.cookie = 'demo_session=; path=/; max-age=0'
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const displayName = user.user_metadata?.name || user.email?.split('@')[0] || 'User'
  const initials    = displayName.slice(0, 2).toUpperCase()
  const pageTitle   = Object.entries(pageTitles).find(([k]) => pathname.startsWith(k))?.[1] ?? 'Workspace'

  return (
    <header className="relative z-[300] flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 font-editorial-sans">

      {/* Left: sidebar toggles + page title */}
      <div className="flex items-center gap-2">
        {/* Mobile hamburger */}
        <button onClick={onMenuOpen} aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition md:hidden">
          <Menu className="h-5 w-5" />
        </button>

        {/* Desktop collapse/expand toggle */}
        <button onClick={onToggleSidebar} aria-label="Toggle sidebar"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden md:flex h-9 w-9 items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition">
          {sidebarCollapsed
            ? <PanelLeft className="h-4.5 w-4.5" />
            : <PanelLeftClose className="h-4.5 w-4.5" />
          }
        </button>

        <div className="h-4 w-px bg-gray-200 hidden md:block" />
        <h1 className="font-editorial text-base font-normal text-gray-800">{pageTitle}</h1>
      </div>

      {/* Right: user menu */}
      <div className="flex items-center">
        <div className="relative">
          <button onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 px-2 py-1.5 transition hover:bg-gray-100">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white">
              {initials}
            </div>
            <div className="hidden text-left sm:block">
              <p className="max-w-[110px] truncate text-sm font-semibold leading-tight text-gray-800">{displayName}</p>
              <p className="max-w-[110px] truncate text-[11px] leading-tight text-gray-400">{user.email}</p>
            </div>
            <ChevronDown className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', menuOpen && 'rotate-180')} />
          </button>

          {menuOpen && (
            <>
              {/* Backdrop — closes menu on outside tap */}
              <div className="fixed inset-0 z-[350]" onClick={() => setMenuOpen(false)} />
              {/* Dropdown — fixed, above header z-index */}
              <div className="fixed right-3 top-[58px] z-[400] w-56 border border-gray-200 bg-white py-1.5 shadow-[0_24px_60px_-20px_rgba(20,20,20,0.3)]">
                <div className="border-b border-gray-100 px-4 py-3">
                  <p className="text-xs font-semibold text-gray-800">{displayName}</p>
                  <p className="truncate text-[11px] text-gray-400">{user.email}</p>
                </div>
                <button onClick={() => { router.push('/settings'); setMenuOpen(false) }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 transition hover:bg-gray-50">
                  <Settings className="h-4 w-4 text-gray-400" /> Settings
                </button>
                <div className="my-1 border-t border-gray-100" />
                <button onClick={signOut}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 transition hover:bg-red-50">
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
