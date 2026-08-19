// app/join/[code]/page.tsx
'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { use, useState } from 'react'
import CodeSlats from '../../../components/CodeSlats'

export default function JoinRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const t = useTranslations('joinRoom')
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')

  return (
    <main className="mx-auto flex max-w-[640px] flex-1 flex-col items-center justify-center gap-6 px-4">
      <p className="font-mono text-[11px] uppercase tracking-[.4em] text-brass">{t('invitedTo')}</p>
      <CodeSlats code={code} />
      <div
        className="flex w-full flex-wrap overflow-hidden border-2 border-brass/60 bg-gradient-to-br from-ticket to-ticket/80 text-ink shadow-[0_30px_80px_-30px_rgba(0,0,0,.9)]"
        style={{ animation: 'revealUp .6s ease-out both' }}
      >
        <div className="flex flex-1 basis-[300px] flex-col gap-4 p-6 sm:p-8">
          <p id="joinNameLabel" className="font-mono text-xs uppercase tracking-widest text-ink/60">
            {t('nameCardTitle')}
          </p>
          <input
            aria-labelledby="joinNameLabel"
            data-testid="join-name-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={24}
            placeholder={t('namePlaceholder')}
            className="h-16 border-0 border-b-[3px] border-ink/40 bg-transparent font-display text-[clamp(28px,4vw,42px)] text-ink outline-none focus:border-exit-red"
          />
          <p className="font-mono text-xs text-ink/55">
            {t('nameCountCaption', { count: displayName.length })}
          </p>
          <button
            type="button"
            data-testid="join-submit"
            disabled={displayName.length === 0}
            onClick={() => {
              sessionStorage.setItem('pendingDisplayName', displayName)
              router.push(`/room/${code}`)
            }}
            className="h-[62px] font-display text-xl tracking-wide text-ticket disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 enabled:cursor-pointer enabled:bg-exit-red"
          >
            {t('joinButton')}
          </button>
        </div>
        <div className="flex flex-1 basis-full flex-col items-center justify-between gap-3 border-t-[3px] border-dashed border-ink/40 bg-ink/[.04] p-4 text-center sm:basis-[168px] sm:border-l-[3px] sm:border-t-0 sm:py-6">
          <p className="font-display text-lg tracking-[.14em] text-ink/80 sm:rotate-180 sm:text-xl sm:[writing-mode:vertical-rl]">
            {t('admitOneLabel')}
          </p>
          <p className="font-mono text-[11px] text-ink/55">{t('seatLabel')}</p>
        </div>
      </div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-brass/85">{t('noPasswordNote')}</p>
    </main>
  )
}
