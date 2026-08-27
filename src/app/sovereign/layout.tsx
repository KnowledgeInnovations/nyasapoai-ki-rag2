import type { Metadata } from 'next'
import { SovereignHeader } from '@/components/sovereign/Header'
import { SovereignFooter } from '@/components/sovereign/Footer'

export const metadata: Metadata = {
  title: 'Sovereign AI | Nyansa AI',
  description:
    "NyansaPo AI's Sovereign AI initiative — a unified intelligence layer for the Ghanaian ecosystem, built for data sovereignty and administrative excellence.",
}

// This section has its own header/footer chrome (branded for the
// Sovereign AI pitch) instead of the site-wide MarketingNav/Footer, so it
// lives at the app root rather than inside the (marketing) route group.
export default function SovereignLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SovereignHeader />
      <main className="flex-1">{children}</main>
      <SovereignFooter />
    </div>
  )
}
