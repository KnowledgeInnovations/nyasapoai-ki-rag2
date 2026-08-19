import type { Metadata } from 'next'
import { Inter, Source_Serif_4, IBM_Plex_Sans } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
// Editorial serif/sans pairing for the brand's visual identity — headings
// use --font-editorial (serif), body copy stays on --font-editorial-sans
// or the app's own Inter depending on the surface. Loaded globally (not
// scoped to one route group) since the rebrand now spans the marketing
// site, auth flow, and the authenticated app itself.
const editorialSerif = Source_Serif_4({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-marketing-serif' })
const editorialSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-marketing-sans' })

export const metadata: Metadata = {
  title: { default: 'Nyansa AI', template: '%s | Nyansa AI' },
  description:
    'Enterprise document intelligence — turn your internal knowledge into decision-ready insights with cited AI answers.',
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || 'https://nyansaai.com'
  ),
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${editorialSerif.variable} ${editorialSans.variable} h-full antialiased`} suppressHydrationWarning data-scroll-behavior="smooth">
      <body className="min-h-full bg-white text-gray-900">{children}</body>
    </html>
  )
}
