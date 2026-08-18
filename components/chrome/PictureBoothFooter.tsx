// components/chrome/PictureBoothFooter.tsx
'use client'

import { useTranslations } from 'next-intl'

export function PictureBoothFooter() {
  const t = useTranslations('chrome')

  return (
    <footer className="relative z-10 flex flex-wrap items-center justify-center gap-3.5 border-t border-brass/25 px-5 py-5 font-mono text-[9.5px] uppercase tracking-widest text-brass/75">
      <span>{t('footerTagline')}</span>
      <span className="opacity-50">·</span>
      <span>{t('tmdbAttribution')}</span>
    </footer>
  )
}
