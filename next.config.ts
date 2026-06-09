import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  compress: true,

  serverExternalPackages: ['officeparser', 'pdf-parse', '@napi-rs/canvas'],

  turbopack: {
    root: path.resolve(__dirname),
  },



  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: 'thebftonline.com' },
    ],
  },

  async headers() {
    return [
      {
        // Never cache API responses
        source: '/api/(.*)',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        // Security headers on all routes
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options',  value: 'nosniff' },
          { key: 'X-Frame-Options',          value: 'DENY' },
          { key: 'Referrer-Policy',          value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection',         value: '1; mode=block' },
        ],
      },
    ]
  },
}

export default nextConfig
