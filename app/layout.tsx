import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import './workspace-design.css'

export const metadata: Metadata = {
  title: 'SWARM AI — One mission. Many minds.',
  description: 'Give one mission to a team of specialized AI agents. SWARM plans, builds, reviews, and keeps moving.',
  icons: { icon: '/favicon.ico', shortcut: '/favicon.ico', apple: '/swarm-icon.png' },
}

export const viewport: Viewport = {
  colorScheme: 'dark light',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: '#111218' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
