// components/RoomShare.tsx
'use client'

import { useTranslations } from 'next-intl'
import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'

export function RoomShare({ code }: { code: string }) {
  const t = useTranslations('roomShare')
  const [copied, setCopied] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${code}` : ''

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
    <Card className="border-2 border-brass bg-velvet">
      <CardContent className="flex flex-col items-center gap-4 p-6">
        <p className="font-mono text-3xl tracking-widest text-marquee">{code}</p>
        <canvas ref={canvasRef} aria-label={`QR code for ${joinUrl}`} className="rounded bg-ticket p-2" />
        <div className="flex gap-2">
          <Button variant="outline" className="border-brass text-ticket" onClick={copyLink}>
            {copied ? t('copied') : t('copyLink')}
          </Button>
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <Button
              className="bg-marquee text-ink hover:bg-marquee/90"
              onClick={() => navigator.share({ title: t('shareTitle'), url: joinUrl })}
            >
              {t('share')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
