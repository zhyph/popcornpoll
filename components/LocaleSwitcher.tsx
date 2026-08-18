// components/LocaleSwitcher.tsx
'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useTransition } from 'react'
import { Button } from './ui/button'
import { setLocaleAction } from '../app/localeAction'
import type { Locale } from '../i18n/request'

export function LocaleSwitcher() {
  const t = useTranslations('localeSwitcher')
  const locale = useLocale()
  const [isPending, startTransition] = useTransition()

  function switchTo(next: Locale) {
    if (next === locale) return
    startTransition(() => {
      void setLocaleAction(next)
    })
  }

  return (
    <div className="flex gap-1 font-mono text-[10px] uppercase tracking-widest text-brass sm:text-xs">
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        className={locale === 'pt-br' ? 'text-marquee' : 'text-brass'}
        onClick={() => switchTo('pt-br')}
      >
        {t('portuguese')}
      </Button>
      <span>/</span>
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        className={locale === 'en-us' ? 'text-marquee' : 'text-brass'}
        onClick={() => switchTo('en-us')}
      >
        {t('english')}
      </Button>
    </div>
  )
}
