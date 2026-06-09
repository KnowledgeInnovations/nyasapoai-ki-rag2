import type { Metadata } from 'next'
import MarketingNav from '@/components/marketing/Nav'
import MarketingFooter from '@/components/marketing/Footer'

export const metadata: Metadata = {
  title: 'NyasapoAI — Enterprise Document Intelligence',
}

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
