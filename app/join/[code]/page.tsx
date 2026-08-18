// app/join/[code]/page.tsx
'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader } from '../../../components/ui/card'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'

export default function JoinRoomPage({ params }: { params: { code: string } }) {
  const t = useTranslations('joinRoom')
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-4">
      <p className="font-mono text-xs uppercase tracking-widest text-brass">{t('invitedTo')}</p>
      <h1 className="font-display text-3xl tracking-widest text-marquee">{params.code}</h1>
      <Card className="w-full border-2 border-brass bg-velvet">
        <CardHeader className="font-mono text-xs uppercase tracking-widest text-brass">
          {t('nameCardTitle')}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="displayName">{t('nameLabel')}</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={24}
              placeholder={t('namePlaceholder')}
            />
          </div>
          <Button
            className="bg-marquee text-ink hover:bg-marquee/90"
            disabled={displayName.length === 0}
            onClick={() => {
              sessionStorage.setItem('pendingDisplayName', displayName)
              router.push(`/room/${params.code}`)
            }}
          >
            {t('joinButton')}
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
