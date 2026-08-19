// app/page.tsx
'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BulbFrame } from '../components/BulbFrame'
import CountUp from '../components/ui/reactbits/CountUp'
import BlurText from '../components/ui/reactbits/BlurText'
import SplitText from '../components/ui/reactbits/SplitText'
import StarBorder from '../components/ui/reactbits/StarBorder'
import { Skeleton } from '../components/ui/skeleton'
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
  const [stats, setStats] = useState<{
    libraryCount: number
    nightsSettled: number
    recentMatches: { title: string; posterPath: string | null; posterSource: 'plex' | 'tmdb'; year: number | null }[]
    plexLinked: boolean
    lastSyncAt: number | null
  } | null>(null)
  const [eligibleCount, setEligibleCount] = useState<number | null>(null)
  // The mockup's genre field is a closed select, not free text — its
  // options come from whatever's actually on the linked library's shelf.
  const [genreOptions, setGenreOptions] = useState<string[]>([])
  const [joinPromptOpen, setJoinPromptOpen] = useState(false)
  const [joinCode, setJoinCode] = useState('')

  useEffect(() => {
    const params = new URLSearchParams()
    if (genre) params.set('genre', genre)
    if (ratingMin) params.set('ratingMin', ratingMin)
    if (yearMin) params.set('yearMin', yearMin)
    if (yearMax) params.set('yearMax', yearMax)

    const timer = setTimeout(() => {
      fetch(`/api/eligible-count?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => body && setEligibleCount(body.count))
        .catch(() => {}) // decorative — a failed fetch just leaves the previous count (or the skeleton) in place
    }, 400)

    return () => clearTimeout(timer)
  }, [genre, ratingMin, yearMin, yearMax])

  useEffect(() => {
    fetch('/api/stats')
      .then((res) => res.json())
      .then(setStats)
      .catch(() => {}) // stats are decorative — a failed fetch just keeps the skeleton state, no error UI
  }, [])

  useEffect(() => {
    fetch('/api/genres')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { genres: string[] } | null) => setGenreOptions(body?.genres ?? []))
      .catch(() => {}) // a failed fetch just leaves the select at "any genre" only
  }, [])

  function submitJoinCode() {
    const code = joinCode.trim()
    if (!code) return
    router.push(`/join/${encodeURIComponent(code)}`)
  }

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
        <BulbFrame count={28} />
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
          {Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className="absolute left-[-7px] h-3.5 w-3.5 rounded-full bg-ink"
              style={{ top: `${10 + i * 10}%` }}
            />
          ))}
          <div className="mb-5 flex items-baseline justify-between gap-3 border-b-2 border-dashed border-ink/35 pb-3">
            <p className="font-display text-2xl tracking-wide sm:text-[28px]">{t('tonightsShowingLabel')}</p>
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink/60">{t('ticketNoLabel')}</p>
          </div>

          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/60">{t('housePicturesLabel')}</p>
          <div className="mb-5 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setCandidateSource('plex')}
              aria-pressed={candidateSource === 'plex'}
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
              aria-pressed={candidateSource === 'plex+tmdb'}
              className={`flex flex-col gap-1.5 border-2 p-3.5 text-left transition-all ${
                candidateSource === 'plex+tmdb' ? 'border-exit-red bg-exit-red/10' : 'border-ink/25'
              }`}
            >
              <span className="font-display text-[15px]">{t('sourcesTmdbTitle')}</span>
              <span className="text-[11.5px] leading-snug opacity-70">{t('sourcesTmdbNote')}</span>
            </button>
          </div>

          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/60">{t('houseRuleLabel')}</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {(['all', 'majority', 'atLeast'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setThresholdKind(kind)}
                aria-pressed={thresholdKind === kind}
                className={`border border-ink/35 px-3.5 py-2.5 font-mono text-[11px] uppercase tracking-wider transition-all ${
                  thresholdKind === kind ? 'bg-ink text-ticket' : 'text-ink/70'
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

          <p className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/60">{t('trimTheBillLabel')}</p>
          <div className="mb-6 grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/60">
              {t('genreLabel')}
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="h-10 cursor-pointer border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              >
                <option value="">{t('anyGenreOption')}</option>
                {genreOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/60">
              {t('minRatingLabel')}
              <input
                type="text"
                placeholder={t('ratingPlaceholder')}
                value={ratingMin}
                onChange={(e) => setRatingMin(e.target.value)}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/60">
              {t('yearFromLabel')}
              <input
                type="text"
                placeholder={t('yearFromPlaceholder')}
                value={yearMin}
                onChange={(e) => setYearMin(e.target.value)}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/60">
              {t('yearToLabel')}
              <input
                type="text"
                placeholder={t('yearToPlaceholder')}
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
            // StarBorder's own inner div ships `bg-gradient-to-b from-black
            // to-gray-900` — an opaque `background-image` layer that paints
            // over `background-color`, so `bg-exit-red` alone (which only
            // sets background-color) was silently invisible underneath it.
            // `bg-none` clears that gradient so the red is what actually
            // renders — this is the create-room button ("PRINT THE
            // TICKETS") always rendering the vendored component's default
            // black instead of the mockup's brick red.
            className="w-full [&>div:last-child]:relative [&>div:last-child]:w-full [&>div:last-child]:rounded-none [&>div:last-child]:border-0 [&>div:last-child]:bg-none [&>div:last-child]:bg-exit-red [&>div:last-child]:py-4 [&>div:last-child]:font-display [&>div:last-child]:text-lg [&>div:last-child]:tracking-wider [&>div:last-child]:text-ticket [&>div:last-child]:transition-colors hover:[&>div:last-child]:bg-[#DC5142]"
          >
            {t('createButton')}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(100deg,transparent_30%,rgba(243,233,210,.35)_50%,transparent_70%)] bg-[length:200%_100%] [animation:shimmer_3.2s_linear_infinite]"
            />
          </StarBorder>
          <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-wider text-ink/50">{t('tearHereLabel')}</p>

          {joinPromptOpen ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                submitJoinCode()
              }}
              className="mt-3.5 flex w-full gap-2"
            >
              <input
                autoFocus
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder={t('joinCodePlaceholder')}
                className="h-11 flex-1 border border-ink/40 bg-transparent px-3 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
              <button
                type="submit"
                className="border border-ink/40 px-4 font-mono text-[11px] uppercase tracking-wider text-ink transition-colors hover:border-exit-red hover:text-exit-red"
              >
                {t('joinCodeGo')}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setJoinPromptOpen(true)}
              className="mt-3.5 w-full border border-dashed border-ink/40 px-3 py-3 font-mono text-[10.5px] uppercase tracking-wider text-ink/75 transition-colors hover:border-exit-red hover:text-exit-red"
            >
              {t('joinRoomButton')}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <div className="border border-brass/40 bg-gradient-to-b from-velvet/60 to-ink/80 p-5 sm:p-6">
            <p className="mb-4 font-mono text-[10.5px] uppercase tracking-[.24em] text-brass">{t('houseTonightLabel')}</p>
            <div className="grid grid-cols-3 gap-3.5">
              <div className="flex flex-col gap-1">
                <div data-testid="stat-library">
                  {stats ? (
                    <CountUp to={stats.libraryCount} className="font-display text-[clamp(30px,4vw,44px)] leading-none text-marquee" />
                  ) : (
                    <Skeleton className="h-10 w-16" />
                  )}
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ticket/60">{t('inLibraryLabel')}</span>
              </div>
              <div className="flex flex-col gap-1">
                <div data-testid="stat-pool">
                  {eligibleCount !== null ? (
                    <CountUp to={eligibleCount} className="font-display text-[clamp(30px,4vw,44px)] leading-none text-marquee" />
                  ) : (
                    <Skeleton className="h-10 w-16" />
                  )}
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ticket/60">{t('inThePoolLabel')}</span>
              </div>
              <div className="flex flex-col gap-1">
                {stats ? (
                  <CountUp to={stats.nightsSettled} className="font-display text-[clamp(30px,4vw,44px)] leading-none text-marquee" />
                ) : (
                  <Skeleton className="h-10 w-16" />
                )}
                <span className="font-mono text-[10px] uppercase tracking-wider text-ticket/60">{t('nightsSettledLabel')}</span>
              </div>
            </div>
          </div>

          {stats && stats.recentMatches.length > 0 && (
            <div className="relative overflow-hidden border border-brass/40 bg-[#17110E] py-4">
              <p className="mb-3 px-4 font-mono text-[10.5px] uppercase tracking-[.24em] text-brass sm:px-6">{t('lastWeekLabel')}</p>
              <div
                className="flex w-max gap-3.5"
                style={{ animation: 'marqueeSlide 32s linear infinite' }}
              >
                {[...stats.recentMatches, ...stats.recentMatches].map((m, i) => (
                  <div key={i} className="flex w-[104px] flex-none flex-col gap-1.5">
                    <div className="flex h-[150px] w-[104px] items-end border border-brass/35 bg-[repeating-linear-gradient(135deg,#241A15_0_7px,#2E211A_7px_14px)] p-1.5">
                      <span className="font-mono text-[8.5px] leading-tight tracking-wider text-ticket/50">{m.title}</span>
                    </div>
                    <span className="font-mono text-[9px] tracking-wider text-brass">{m.year ?? ''}</span>
                  </div>
                ))}
              </div>
              <div
                className="absolute inset-x-0 top-0 h-3 bg-[repeating-linear-gradient(90deg,rgba(243,233,210,.22)_0_10px,transparent_10px_26px)]"
                style={{ animation: 'sprocket 1.1s linear infinite' }}
              />
              <div
                className="absolute inset-x-0 bottom-0 h-3 bg-[repeating-linear-gradient(90deg,rgba(243,233,210,.22)_0_10px,transparent_10px_26px)]"
                style={{ animation: 'sprocket 1.1s linear infinite' }}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5 border border-dashed border-brass/45 px-[18px] py-3.5 font-mono text-[11px] tracking-wider text-ticket/65">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{
                background: stats?.plexLinked ? '#1C6666' : '#CF4436',
                boxShadow: stats?.plexLinked ? '0 0 10px 2px rgba(28,102,102,.6)' : 'none',
              }}
            />
            {stats?.plexLinked
              ? stats.lastSyncAt !== null
                ? t('plexLinkedStatus', { minutes: Math.max(0, Math.round((Date.now() - stats.lastSyncAt) / 60_000)) })
                : t('plexLinkedSyncUnknown')
              : t('plexNotLinkedStatus')}
            <a
              href="/setup"
              className="ml-auto border border-brass/50 px-2.5 py-1.5 text-brass hover:border-marquee hover:text-ticket"
            >
              {t('projectionBoothLabel')}
            </a>
          </div>
        </div>
        <div className="relative col-span-full flex flex-wrap items-center gap-5 border border-brass/40 bg-gradient-to-br from-ticket to-ticket/85 px-5 py-5 text-ink shadow-[0_18px_44px_-24px_rgba(0,0,0,.85)] sm:px-7">
          <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[.24em] text-ink/60">{t('flyingSoloKicker')}</p>
            <p className="font-display text-xl tracking-wide sm:text-2xl">{t('flyingSoloTitle')}</p>
            <p className="max-w-[56ch] text-[12.5px] leading-relaxed text-ink/70">{t('flyingSoloBody')}</p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/solo')}
            data-testid="flying-solo"
            className="flex-none border-2 border-ink/50 px-5 py-3.5 font-display text-sm tracking-wide text-ink transition-colors hover:bg-ink hover:text-ticket sm:text-base"
          >
            {t('flyingSoloButton')}
          </button>
        </div>
      </div>
    </main>
  )
}
