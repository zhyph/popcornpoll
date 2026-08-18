// app/layout.tsx
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import { Anton, JetBrains_Mono, Work_Sans } from 'next/font/google'
import { LocaleSwitcher } from '../components/LocaleSwitcher'
import { SpotlightBackground } from '../components/SpotlightBackground'
import { Toaster } from '../components/ui/sonner'
import './globals.css'

const display = Anton({ subsets: ['latin'], weight: '400', variable: '--font-display' })
const body = Work_Sans({ subsets: ['latin'], variable: '--font-body' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata = { title: 'PopcornPoll' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale} className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <NextIntlClientProvider>
          <SpotlightBackground />
          <div className="fixed right-4 top-4 z-50">
            <LocaleSwitcher />
          </div>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
