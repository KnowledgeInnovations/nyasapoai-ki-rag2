'use client'

import { useState } from 'react'
import { Bell, ChevronDown, LogOut, Settings, Menu, PanelLeftClose, PanelLeft } from 'lucide-react'
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
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4">

      {/* Left: sidebar toggles + page title */}
      <div className="flex items-center gap-2">
        {/* Mobile hamburger */}
        <button onClick={onMenuOpen} aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition md:hidden">
          <Menu className="h-5 w-5" />
        </button>

        {/* Desktop collapse/expand toggle */}
        <button onClick={onToggleSidebar} aria-label="Toggle sidebar"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden md:flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition">
          {sidebarCollapsed
            ? <PanelLeft className="h-4.5 w-4.5" />
            : <PanelLeftClose className="h-4.5 w-4.5" />
          }
        </button>

        <div className="h-4 w-px bg-gray-200 hidden md:block" />
        <h1 className="text-base font-bold text-gray-900">{pageTitle}</h1>
      </div>

      {/* Right: bell + user */}
      <div className="flex items-center gap-1.5">
        <button aria-label="Notifications"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition">
          <Bell className="h-4.5 w-4.5" />
        </button>

        <div className="relative">
          <button onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-gray-100 transition">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white shadow-sm">
              {initials}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-semibold text-gray-800 max-w-[110px] truncate leading-tight">{displayName}</p>
              <p className="text-[11px] text-gray-400 max-w-[110px] truncate leading-tight">{user.email}</p>
            </div>
            <ChevronDown className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', menuOpen && 'rotate-180')} />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1.5 z-20 w-52 rounded-2xl border border-gray-200 bg-white py-1.5 shadow-2xl shadow-black/10">
                <div className="px-4 py-2.5 border-b border-gray-100">
                  <p className="text-xs font-bold text-gray-800">{displayName}</p>
                  <p className="text-[11px] text-gray-400 truncate">{user.email}</p>
                </div>
                <button onClick={() => { router.push('/settings'); setMenuOpen(false) }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition">
                  <Settings className="h-4 w-4 text-gray-400" /> Settings
                </button>
                <div className="my-1 border-t border-gray-100" />
                <button onClick={signOut}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition">
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
