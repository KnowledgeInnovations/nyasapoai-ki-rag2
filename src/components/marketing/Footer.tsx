import Link from 'next/link'

const links = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/security', label: 'Security' },
  { href: '/contact', label: 'Contact' },
  { href: '/auth/login', label: 'Sign in' },
]

export default function MarketingFooter() {
  return (
    <footer className="bg-gray-50 border-t border-gray-200">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-brand">Nyansapo</span>
            <span className="rounded-md bg-brand px-1.5 py-0.5 text-xs font-semibold text-white">AI</span>
          </div>

          {/* Links */}
          <nav className="flex flex-wrap gap-x-6 gap-y-2 justify-center">
            {links.map(l => (
              <Link key={l.href} href={l.href}
                className="text-sm text-gray-500 transition hover:text-gray-900">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200 text-center text-xs text-gray-400">
          &copy; {new Date().getFullYear()} NyasapoAI. All rights reserved.
        </div>
      </div>
    </footer>
  )
}
