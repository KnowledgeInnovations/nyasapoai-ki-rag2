import type { Metadata } from 'next'
import MarketingNav from '@/components/marketing/Nav'
import MarketingFooter from '@/components/marketing/Footer'

export const metadata: Metadata = {
  title: 'Nyansa AI — Enterprise Document Intelligence',
}

// The editorial serif/sans font variables are loaded globally in the root
// layout now (the rebrand spans the whole app, not just marketing).
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </>
  )
}
