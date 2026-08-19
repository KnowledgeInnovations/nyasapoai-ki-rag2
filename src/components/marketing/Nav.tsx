'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const navLinks = [
  { href: '/#features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/security', label: 'Security' },
  { href: '/contact', label: 'Contact' },
]

export default function MarketingNav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const handle = () => setScrolled(window.scrollY > 24)
    window.addEventListener('scroll', handle, { passive: true })
    handle()
    return () => window.removeEventListener('scroll', handle)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      {/* ── Top bar ─────────────────────────────────────────── */}
      <header className={cn(
        'fixed top-0 left-0 right-0 z-30 transition-all duration-300',
        scrolled
          ? 'bg-white/95 backdrop-blur-xl shadow-lg shadow-black/5 border-b border-gray-200'
          : 'bg-transparent'
      )}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 md:px-8">
          <Link href="/" className="font-editorial shrink-0 text-[21px] text-gray-900">
            Nyansa<span className="text-brand">·</span>AI
          </Link>

          <nav className="hidden md:flex items-center gap-9 font-editorial-sans">
            {navLinks.map(l => (
              <Link key={l.href} href={l.href}
                className="group relative text-[13.5px] font-medium text-gray-600 transition hover:text-gray-900">
                {l.label}
                <span className="absolute -bottom-1 left-0 h-px w-0 bg-brand transition-all duration-200 group-hover:w-full" />
              </Link>
            ))}
          </nav>

          <Link href="/auth/login"
            className="hidden md:inline-flex items-center gap-2 bg-brand px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-brand-dark">
            Sign in <ArrowRight className="h-3.5 w-3.5" />
          </Link>

          <button onClick={() => setOpen(true)} aria-label="Open menu"
            className="md:hidden flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition">
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* ── Overlay ──────────────────────────────────────────── */}
      <div
        onClick={() => setOpen(false)}
        className={cn(
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 md:hidden',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
      />

      {/* ── Drawer — slides from LEFT ─────────────────────────── */}
      <div className={cn(
        'fixed left-0 top-0 z-50 flex h-full w-72 max-w-[82vw] flex-col',
        'bg-white border-r border-gray-200 shadow-2xl shadow-black/10',
        'transition-transform duration-300 ease-in-out md:hidden',
        open ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Header */}
        <div className="flex h-16 shrink-0 items-center justify-between px-5 border-b border-gray-200">
          <div className="font-editorial text-lg text-gray-900">
            Nyansa<span className="text-brand">·</span>AI
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Links */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {navLinks.map(l => (
            <Link key={l.href} href={l.href}
              className="flex items-center rounded-xl px-4 py-3.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900">
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="shrink-0 p-5 border-t border-gray-200 space-y-3">
          <Link href="/auth/login" onClick={() => setOpen(false)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3.5 text-sm font-bold text-white transition hover:bg-brand-dark shadow-lg shadow-brand/20">
            Sign in to Workspace <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="text-center text-[11px] text-gray-400">Powered by Nyansa AI</p>
        </div>
      </div>
    </>
  )
}
