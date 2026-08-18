// app/layout.tsx
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import { Anton, JetBrains_Mono, Work_Sans } from 'next/font/google'
import { AtmosphereLayer } from '../components/chrome/AtmosphereLayer'
import { ClickSparkProvider } from '../components/chrome/ClickSparkProvider'
import { CurtainOverlay } from '../components/chrome/CurtainOverlay'
import { PictureBoothFooter } from '../components/chrome/PictureBoothFooter'
import { PictureBoothHeader } from '../components/chrome/PictureBoothHeader'
import { RoomStatusProvider } from '../components/chrome/RoomStatusContext'
import { LocaleSwitcher } from '../components/LocaleSwitcher'
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
          <RoomStatusProvider>
            <AtmosphereLayer />
            <CurtainOverlay open countdownNumber={null} />
            <ClickSparkProvider>
              <div className="fixed right-2 top-2 z-50 sm:right-4 sm:top-4">
                <LocaleSwitcher />
              </div>
              <div className="flex min-h-screen flex-col">
                <PictureBoothHeader />
                <div className="flex-1">{children}</div>
                <PictureBoothFooter />
              </div>
            </ClickSparkProvider>
          </RoomStatusProvider>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
