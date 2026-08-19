import type { Metadata } from 'next'
import { Source_Serif_4, IBM_Plex_Sans } from 'next/font/google'
import MarketingNav from '@/components/marketing/Nav'
import MarketingFooter from '@/components/marketing/Footer'

export const metadata: Metadata = {
  title: 'Nyansa AI — Enterprise Document Intelligence',
}

// Scoped to the marketing site only — the authenticated app keeps Inter
// (set globally in the root layout). An editorial serif/sans pairing for
// the public-facing rebrand, distinct from the generic Inter-everywhere
// look, without touching the app's own typography.
const serif = Source_Serif_4({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-marketing-serif' })
const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-marketing-sans' })

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className={`${serif.variable} ${plexSans.variable}`}>
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  )
}
