// components/RoomShare.tsx
'use client'

import { useTranslations } from 'next-intl'
import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import CodeSlats from './CodeSlats'

export function RoomShare({ code }: { code: string }) {
  const t = useTranslations('roomShare')
  const tRoom = useTranslations('room')
  const [copied, setCopied] = useState(false)
  const [canShare, setCanShare] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${code}` : ''

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && 'share' in navigator)
  }, [])

  useEffect(() => {
    if (!joinUrl || !canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, joinUrl, {
      width: 180,
      margin: 1,
      color: { dark: '#17110E', light: '#F3E9D2' },
    })
  }, [joinUrl])

  async function copyLink() {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(joinUrl)
    } else {
      const input = document.createElement('input')
      input.value = joinUrl
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    setCopied(true)
    toast(t('linkCopiedToast'))
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex w-full flex-col items-center gap-4 border-2 border-brass/70 bg-gradient-to-b from-velvet/80 to-ink/90 p-6 sm:p-8">
      <p className="font-mono text-[10.5px] uppercase tracking-[.3em] text-brass">{tRoom('doorCodeLabel')}</p>
      <CodeSlats code={code} size="small" />
      <canvas ref={canvasRef} aria-label={`QR code for ${joinUrl}`} className="rounded bg-ticket p-2" />
      <div className="flex flex-wrap justify-center gap-2.5">
        <button
          type="button"
          onClick={copyLink}
          className="border border-brass/60 bg-transparent px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ticket hover:border-marquee hover:text-marquee"
        >
          {copied ? t('copied') : t('copyLink')}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={() => navigator.share({ title: t('shareTitle'), url: joinUrl })}
            className="bg-marquee px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink hover:bg-marquee/90"
          >
            {t('share')}
          </button>
        )}
      </div>
    </div>
  )
}
