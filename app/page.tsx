// app/page.tsx
'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { BulbFrame } from '../components/BulbFrame'
import BlurText from '../components/ui/reactbits/BlurText'
import SplitText from '../components/ui/reactbits/SplitText'
import StarBorder from '../components/ui/reactbits/StarBorder'
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
    <main className="mx-auto flex flex-1 max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="relative flex flex-col items-center gap-4 border-2 border-brass/75 bg-gradient-to-b from-velvet/85 to-ink/90 px-6 py-8 shadow-[0_30px_80px_-30px_rgba(0,0,0,.9)] sm:px-10 sm:py-11">
        <BulbFrame count={24} />
        <p className="font-mono text-[11px] uppercase tracking-[.42em] text-brass">{t('performancesTag')}</p>
        <SplitText
          text="POPCORNPOLL"
          tag="h1"
          className="font-display text-center text-[clamp(46px,11vw,132px)] leading-[.9] tracking-wide text-marquee [animation:chaseGlow_3.4s_ease-in-out_infinite]"
          splitType="chars"
          delay={60}
        />
        <BlurText
          text={t('titleSubhead')}
          animateBy="words"
          direction="top"
          className="max-w-[52ch] text-center text-sm leading-relaxed text-ticket/80 sm:text-base"
        />
      </div>
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div
          className="relative bg-gradient-to-br from-ticket to-ticket/80 p-6 text-ink shadow-[0_30px_60px_-25px_rgba(0,0,0,.9)] sm:p-8"
          style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%)' }}
        >
          <div className="mb-5 flex items-baseline justify-between gap-3 border-b-2 border-dashed border-ink/35 pb-3">
            <p className="font-display text-2xl tracking-wide sm:text-[28px]">{t('tonightsShowingLabel')}</p>
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink/60">{t('ticketNoLabel')}</p>
          </div>

          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/62">{t('housePicturesLabel')}</p>
          <div className="mb-5 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setCandidateSource('plex')}
              className={`flex flex-col gap-1.5 border-2 p-3.5 text-left transition-all ${
                candidateSource === 'plex' ? 'border-exit-red bg-exit-red/10' : 'border-ink/25'
              }`}
            >
              <span className="font-display text-[15px]">{t('sourcesPlexTitle')}</span>
              <span className="text-[11.5px] leading-snug opacity-70">{t('sourcesPlexNote')}</span>
            </button>
            <button
              type="button"
              onClick={() => setCandidateSource('plex+tmdb')}
              className={`flex flex-col gap-1.5 border-2 p-3.5 text-left transition-all ${
                candidateSource === 'plex+tmdb' ? 'border-exit-red bg-exit-red/10' : 'border-ink/25'
              }`}
            >
              <span className="font-display text-[15px]">{t('sourcesTmdbTitle')}</span>
              <span className="text-[11.5px] leading-snug opacity-70">{t('sourcesTmdbNote')}</span>
            </button>
          </div>

          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/62">{t('houseRuleLabel')}</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {(['all', 'majority', 'atLeast'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setThresholdKind(kind)}
                className={`px-3.5 py-2.5 font-mono text-[11px] uppercase tracking-wider transition-all ${
                  thresholdKind === kind ? 'bg-ink text-ticket' : 'border border-ink/35 text-ink/70'
                }`}
              >
                {kind === 'all' ? t('matchRuleAll') : kind === 'majority' ? t('matchRuleMajority') : t('matchRuleAtLeast')}
              </button>
            ))}
          </div>

          {thresholdKind === 'atLeast' && (
            <div className="mb-4 flex items-center justify-between gap-3.5 border border-ink/25 bg-ink/5 p-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-ink/70">{t('yesVotesNeededLabel')}</span>
              <div className="flex items-center gap-3.5">
                <button
                  type="button"
                  onClick={() => setAtLeastN(Math.max(1, atLeastN - 1))}
                  className="h-[34px] w-[34px] border border-ink/40 text-lg leading-none"
                >
                  −
                </button>
                <span className="min-w-8 text-center font-display text-2xl">{atLeastN}</span>
                <button
                  type="button"
                  onClick={() => setAtLeastN(atLeastN + 1)}
                  className="h-[34px] w-[34px] border border-ink/40 text-lg leading-none"
                >
                  +
                </button>
              </div>
            </div>
          )}

          <p className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/62">{t('trimTheBillLabel')}</p>
          <div className="mb-6 grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/62">
              {t('genreLabel')}
              <input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder={t('genrePlaceholder')}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/62">
              {t('minRatingLabel')}
              <input
                type="number"
                step={0.1}
                min={0}
                max={10}
                value={ratingMin}
                onChange={(e) => setRatingMin(e.target.value)}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/62">
              {t('yearFromLabel')}
              <input
                type="number"
                value={yearMin}
                onChange={(e) => setYearMin(e.target.value)}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/62">
              {t('yearToLabel')}
              <input
                type="number"
                value={yearMax}
                onChange={(e) => setYearMax(e.target.value)}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
          </div>

          <StarBorder
            as="button"
            type="button"
            onClick={createRoom}
            data-testid="create-room"
            color="#F3E9D2"
            speed="3.2s"
            className="w-full [&>div:last-child]:w-full [&>div:last-child]:rounded-none [&>div:last-child]:border-0 [&>div:last-child]:bg-exit-red [&>div:last-child]:py-4 [&>div:last-child]:font-display [&>div:last-child]:text-lg [&>div:last-child]:tracking-wider [&>div:last-child]:text-ticket"
          >
            {t('createButton')}
          </StarBorder>
          <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-wider text-ink/50">{t('tearHereLabel')}</p>

          {candidateSource === 'plex+tmdb' && (
            <p className="mt-3 text-center text-xs text-ink/55">{t('tmdbAttribution')}</p>
          )}
        </div>
        {/* TODO(Task 10): remove this placeholder and add the real second grid column here, then close the grid */}
      </div>
    </main>
  )
}
