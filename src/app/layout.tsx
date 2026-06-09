import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: { default: 'NyasapoAI', template: '%s | NyasapoAI' },
  description:
    'Enterprise document intelligence — turn your internal knowledge into decision-ready insights with cited AI answers.',
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || 'https://nyasapoai.com'
  ),
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning data-scroll-behavior="smooth">
      <body className="min-h-full bg-white text-gray-900">{children}</body>
    </html>
  )
}
