// app/page.tsx
'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Separator } from '../components/ui/separator'
import type { CandidateSource, MatchThreshold, TmdbFilters } from '../server/room/types'

export default function CreateRoomPage() {
  const t = useTranslations('createRoom')
  const tErrors = useTranslations('errors')
  const router = useRouter()
  const [candidateSource, setCandidateSource] = useState<CandidateSource>('plex')
  const [thresholdKind, setThresholdKind] = useState<MatchThreshold['kind']>('all')
  const [atLeastN, setAtLeastN] = useState(2)
  const [genre, setGenre] = useState('')
  const [yearMin, setYearMin] = useState('')
  const [yearMax, setYearMax] = useState('')
  const [ratingMin, setRatingMin] = useState('')

  async function createRoom() {
    const matchThreshold: MatchThreshold =
      thresholdKind === 'atLeast' ? { kind: 'atLeast', n: atLeastN } : ({ kind: thresholdKind } as MatchThreshold)
    const tmdbFilters: TmdbFilters = {
      genre: genre || undefined,
      yearMin: yearMin ? Number.parseInt(yearMin, 10) : undefined,
      yearMax: yearMax ? Number.parseInt(yearMax, 10) : undefined,
      ratingMin: ratingMin ? Number.parseFloat(ratingMin) : undefined,
    }
    const res = await fetch('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ candidateSource, matchThreshold, tmdbFilters }),
    })
    if (!res.ok) {
      // A non-2xx response body isn't guaranteed to be valid JSON (a bare
      // 500 from the top-level HTTP dispatch's catch-all has none at all) —
      // guard the parse so a network-shaped failure doesn't also throw here.
      const code = await res
        .json()
        .then((b) => b?.error?.code as string | undefined)
        .catch(() => undefined)
      toast(code && tErrors.has(code) ? tErrors(code) : tErrors('generic'))
      return
    }
    const body = await res.json()
    sessionStorage.setItem(`hostClaimToken:${body.roomCode}`, body.hostClaimToken)
    router.push(`/room/${body.roomCode}`)
  }

  return (
    <main className="mx-auto flex flex-1 max-w-md flex-col items-center justify-center gap-6 px-4">
      <h1 className="font-display text-5xl text-marquee">POPCORNPOLL</h1>
      <Card className="w-full border-2 border-brass bg-velvet">
        <CardHeader className="font-mono text-xs uppercase tracking-widest text-brass">
          {t('title')}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t('candidateSourceLabel')}</Label>
            <Select value={candidateSource} onValueChange={(v) => setCandidateSource(v as CandidateSource)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="plex">{t('candidateSourcePlex')}</SelectItem>
                <SelectItem value="plex+tmdb">{t('candidateSourcePlexTmdb')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('matchRuleLabel')}</Label>
            <Select value={thresholdKind} onValueChange={(v) => setThresholdKind(v as MatchThreshold['kind'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('matchRuleAll')}</SelectItem>
                <SelectItem value="majority">{t('matchRuleMajority')}</SelectItem>
                <SelectItem value="atLeast">{t('matchRuleAtLeast')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {thresholdKind === 'atLeast' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="atLeastN">{t('atLeastNLabel')}</Label>
              <Input
                id="atLeastN"
                type="number"
                min={1}
                value={atLeastN}
                onChange={(e) => setAtLeastN(Number.parseInt(e.target.value, 10) || 1)}
              />
            </div>
          )}

          <Separator className="bg-brass/40" />
          <p className="font-mono text-xs uppercase tracking-widest text-brass">{t('filtersLabel')}</p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="genre">{t('genreLabel')}</Label>
            <Input id="genre" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder={t('genrePlaceholder')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="yearMin">{t('yearFromLabel')}</Label>
              <Input id="yearMin" type="number" value={yearMin} onChange={(e) => setYearMin(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="yearMax">{t('yearToLabel')}</Label>
              <Input id="yearMax" type="number" value={yearMax} onChange={(e) => setYearMax(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ratingMin">{t('minRatingLabel')}</Label>
            <Input
              id="ratingMin"
              type="number"
              step={0.1}
              min={0}
              max={10}
              value={ratingMin}
              onChange={(e) => setRatingMin(e.target.value)}
            />
          </div>

          <Button className="mt-2 bg-marquee text-ink hover:bg-marquee/90" onClick={createRoom}>
            {t('createButton')}
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
