"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Search, Zap } from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  { name: "Solutions", href: "/sovereign" },
  { name: "Policies", href: "/sovereign/policies" },
  { name: "Data", href: "/sovereign/data" },
  { name: "Support", href: "/sovereign/support" },
]

export function SovereignHeader() {
  const pathname = usePathname()
  const isDashboard =
    pathname.startsWith("/sovereign/dashboard") ||
    pathname.startsWith("/sovereign/ai-models") ||
    pathname.startsWith("/sovereign/ai-assistant") ||
    pathname.startsWith("/sovereign/library") ||
    pathname.startsWith("/sovereign/settings") ||
    pathname.startsWith("/sovereign/analytics")

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#e2e2e2] bg-white">
      <div className="flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/sovereign" className="flex items-center gap-2">
            {isDashboard ? (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2563eb]">
                <Zap className="h-4 w-4 text-white" />
              </div>
            ) : null}
            <span className="text-xl font-bold text-[#0f172a]">NyansaPo</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "text-sm font-medium transition-colors hover:text-[#2563eb]",
                  pathname === item.href
                    ? "text-[#2563eb] underline underline-offset-4"
                    : "text-[#424656]"
                )}
              >
                {item.name}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative hidden md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7280]" />
            <input
              type="search"
              placeholder={isDashboard ? "Search..." : "Search insights..."}
              className="h-9 w-64 rounded-lg border border-[#e2e2e2] bg-[#f8fafc] pl-9 pr-3 text-sm text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/40"
            />
          </div>
          <Link
            href="/sovereign/dashboard"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-[#2563eb] px-4 text-sm font-medium text-white transition-colors hover:bg-[#004fcb]"
          >
            Access
          </Link>
        </div>
      </div>
    </header>
  )
}
