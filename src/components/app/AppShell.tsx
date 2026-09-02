'use client'

import { useState, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'
import AppSidebar from './Sidebar'
import AppTopNav from './TopNav'
import AuthListener from './AuthListener'

interface Props {
  user: User
  role: string
  tenantName: string
  tenantLogoUrl?: string | null
  isPlatformAdmin?: boolean
  isPlatformTenant?: boolean
  children: React.ReactNode
}

export default function AppShell({ user, role, tenantName, tenantLogoUrl, isPlatformAdmin, isPlatformTenant, children }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Restore collapsed preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sidebar-collapsed')
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === 'true') setCollapsed(true)
    } catch {}
  }, [])

  // Persist preference
  useEffect(() => {
    try { localStorage.setItem('sidebar-collapsed', String(collapsed)) } catch {}
  }, [collapsed])

  // Close mobile drawer on resize to desktop
  useEffect(() => {
    const handle = () => { if (window.innerWidth >= 768) setMobileOpen(false) }
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [])

  return (
    <div className="flex overflow-hidden bg-paper font-editorial-sans" style={{ height: '100dvh' }}>
      <AuthListener />
      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <AppSidebar
        role={role}
        tenantName={tenantName}
        tenantLogoUrl={tenantLogoUrl}
        isPlatformAdmin={isPlatformAdmin}
        isPlatformTenant={isPlatformTenant}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onToggle={() => setCollapsed(c => !c)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppTopNav
          user={user}
          onMenuOpen={() => setMobileOpen(true)}
          sidebarCollapsed={collapsed}
          onToggleSidebar={() => setCollapsed(c => !c)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
