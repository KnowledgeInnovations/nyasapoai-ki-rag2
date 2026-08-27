import Link from "next/link"

export function SovereignFooter() {
  return (
    <footer className="w-full border-t border-[#e2e2e2] bg-white px-6 py-4">
      <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
        <div className="flex items-center gap-2">
          <span className="font-bold text-[#0f172a]">GovAI</span>
          <span className="text-sm text-[#6b7280]">
            © 2024 GovAI Initiative. All rights reserved.
          </span>
        </div>
        <nav className="flex items-center gap-6">
          <Link href="/sovereign/privacy" className="text-sm text-[#6b7280] hover:text-[#2563eb]">
            Privacy
          </Link>
          <Link href="/sovereign/terms" className="text-sm text-[#6b7280] hover:text-[#2563eb]">
            Terms
          </Link>
          <Link href="/sovereign/accessibility" className="text-sm text-[#6b7280] hover:text-[#2563eb]">
            Accessibility
          </Link>
          <Link href="/sovereign/contact" className="text-sm text-[#6b7280] hover:text-[#2563eb]">
            Contact
          </Link>
        </nav>
      </div>
    </footer>
  )
}
