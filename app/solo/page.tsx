// app/solo/page.tsx
'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import CodeSlats from '../../components/CodeSlats'
import { EdgeState } from '../../components/EdgeState'
import { SurpriseReveal } from '../../components/SurpriseReveal'
import { useSetRoomStep } from '../../components/chrome/RoomStatusContext'
import type { PoolEntry } from '../../server/pool/buildPool'
import type { CandidateSource } from '../../server/room/types'

type Screen = 'filters' | 'shortlist' | 'pick'
type SubmitError = 'pool_too_small' | 'library_empty' | null

export default function SoloPage() {
  const t = useTranslations('solo')
  const tCreateRoom = useTranslations('createRoom')
  const tErrors = useTranslations('errors')
  const tEdge = useTranslations('edgeState')
  const router = useRouter()

  const [screen, setScreen] = useState<Screen>('filters')
  const [candidateSource, setCandidateSource] = useState<CandidateSource>('plex')
  const [genre, setGenre] = useState('')
  const [ratingMin, setRatingMin] = useState('')
  const [yearMin, setYearMin] = useState('')
  const [yearMax, setYearMax] = useState('')
  const [eligibleCount, setEligibleCount] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<SubmitError>(null)

  const [shortlist, setShortlist] = useState<PoolEntry[]>([])
  const [degraded, setDegraded] = useState(false)
  const [seen, setSeen] = useState<number[]>([])

  const [surpriseVisible, setSurpriseVisible] = useState(false)
  const [surpriseSpinning, setSurpriseSpinning] = useState(false)
  const [surpriseCard, setSurpriseCard] = useState<PoolEntry | null>(null)

  const [pickedCard, setPickedCard] = useState<PoolEntry | null>(null)
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  useSetRoomStep(screen === 'filters' ? 'soloFilters' : screen === 'shortlist' ? 'soloShortlist' : 'soloPick')

  // Same live-count preview /api/eligible-count already powers on the box
  // office's create-room form — reused as-is (same 400ms debounce, same
  // Plex-only-undercounts-plex+tmdb caveat).
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
        .catch(() => {})
    }, 400)

    return () => clearTimeout(timer)
  }, [genre, ratingMin, yearMin, yearMax])

  function resetSolo() {
    setGenre('')
    setRatingMin('')
    setYearMin('')
    setYearMax('')
    setEligibleCount(null)
    setSubmitError(null)
    setShortlist([])
    setSeen([])
    setPickedCard(null)
    setRoomCode(null)
    setScreen('filters')
  }

  async function submitSolo() {
    if (submitting) return
    setSubmitting(true)
    setSubmitError(null)
    const params = new URLSearchParams()
    if (genre) params.set('genre', genre)
    if (ratingMin) params.set('ratingMin', ratingMin)
    if (yearMin) params.set('yearMin', yearMin)
    if (yearMax) params.set('yearMax', yearMax)
    params.set('candidateSource', candidateSource)

    const res = await fetch(`/api/solo/pool?${params.toString()}`)
    setSubmitting(false)
    if (!res.ok) {
      const code = await res
        .json()
        .then((b) => b?.error?.code as string | undefined)
        .catch(() => undefined)
      if (code === 'pool_too_small' || code === 'library_empty') {
        setSubmitError(code)
        return
      }
      toast(code && tErrors.has(code) ? tErrors(code) : tErrors('generic'))
      return
    }
    const body = await res.json()
    setShortlist(body.pool)
    setDegraded(body.degraded)
    setSeen([])
    setScreen('shortlist')
  }

  async function confirmPick(entry: PoolEntry) {
    if (picking) return
    setPicking(true)
    const res = await fetch('/api/solo/pick', {
      method: 'POST',
      body: JSON.stringify({ movieId: entry.movieId }),
    })
    setPicking(false)
    if (!res.ok) {
      const code = await res
        .json()
        .then((b) => b?.error?.code as string | undefined)
        .catch(() => undefined)
      toast(code && tErrors.has(code) ? tErrors(code) : tErrors('generic'))
      return
    }
    const body = await res.json()
    setPickedCard(entry)
    setRoomCode(body.roomCode)
    setSurpriseVisible(false)
    setScreen('pick')
  }

  async function surpriseMe() {
    setSurpriseVisible(true)
    setSurpriseSpinning(true)
    // A brief minimum spin so the reveal reads as a real shuffle rather
    // than an instant swap, regardless of how fast the fetch resolves.
    const SPIN_MS = 1200
    try {
      const [res] = await Promise.all([
        fetch('/api/solo/surprise', {
          method: 'POST',
          body: JSON.stringify({ movieIds: shortlist.map((e) => e.movieId), exclude: seen }),
        }),
        new Promise((resolve) => setTimeout(resolve, SPIN_MS)),
      ])
      if (!res.ok) {
        setSurpriseVisible(false)
        toast(tErrors('generic'))
        return
      }
      const body = await res.json()
      setSurpriseCard(body.entry)
      setSeen((prev) => [...prev, body.entry.movieId])
      setSurpriseSpinning(false)
    } catch {
      setSurpriseVisible(false)
      toast(tErrors('generic'))
    }
  }

  if (submitError) {
    const kind = submitError === 'library_empty' ? 'emptylib' : 'poolfail'
    return (
      <EdgeState
        kind={kind}
        testId={kind === 'poolfail' ? 'edge-poolfail' : 'edge-emptylib'}
        kicker={tEdge(kind === 'poolfail' ? 'poolFailKicker' : 'emptyLibraryKicker')}
        title={tEdge(kind === 'poolfail' ? 'poolFailTitle' : 'emptyLibraryTitle')}
        body={tEdge(kind === 'poolfail' ? 'poolFailBody' : 'emptyLibraryBody')}
        detail={tEdge(kind === 'poolfail' ? 'poolFailDetail' : 'emptyLibraryDetail')}
        primaryLabel={tEdge(kind === 'poolfail' ? 'poolFailPrimary' : 'emptyLibraryPrimary')}
        onPrimary={() => (kind === 'poolfail' ? setSubmitError(null) : router.push('/setup'))}
        secondaryLabel={tEdge(kind === 'poolfail' ? 'poolFailSecondary' : 'emptyLibraryStayLabel')}
        onSecondary={() => setSubmitError(null)}
      />
    )
  }

  if (screen === 'filters') {
    const blocked = eligibleCount !== null && eligibleCount < 5
    return (
      <main className="mx-auto flex flex-1 max-w-2xl flex-col items-center gap-6 px-4 py-10 text-center sm:gap-7">
        <div className="flex flex-col items-center gap-2.5">
          <p className="font-mono text-[10.5px] uppercase tracking-[.4em] text-brass">{t('kicker')}</p>
          <h2 className="font-display text-[clamp(30px,6.4vw,58px)] leading-[.98] tracking-wide text-ticket">{t('title')}</h2>
          <p className="max-w-[52ch] text-sm leading-relaxed text-ticket/72">{t('subhead')}</p>
        </div>

        <div
          className="relative w-full bg-gradient-to-br from-ticket to-ticket/80 p-6 text-left text-ink shadow-[0_30px_60px_-25px_rgba(0,0,0,.9)] sm:p-8"
          style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%)' }}
        >
          <div className="mb-5 flex items-baseline justify-between gap-3 border-b-2 border-dashed border-ink/35 pb-3">
            <p className="font-display text-2xl tracking-wide">{t('singleAdmissionLabel')}</p>
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink/60">{t('seatLabel')}</p>
          </div>

          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/60">{tCreateRoom('housePicturesLabel')}</p>
          <div className="mb-5 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setCandidateSource('plex')}
              aria-pressed={candidateSource === 'plex'}
              className={`flex flex-col gap-1.5 border-2 p-3.5 text-left transition-all ${candidateSource === 'plex' ? 'border-exit-red bg-exit-red/10' : 'border-ink/25'}`}
            >
              <span className="font-display text-[15px]">{tCreateRoom('sourcesPlexTitle')}</span>
              <span className="text-[11.5px] leading-snug opacity-70">{tCreateRoom('sourcesPlexNote')}</span>
            </button>
            <button
              type="button"
              onClick={() => setCandidateSource('plex+tmdb')}
              aria-pressed={candidateSource === 'plex+tmdb'}
              className={`flex flex-col gap-1.5 border-2 p-3.5 text-left transition-all ${candidateSource === 'plex+tmdb' ? 'border-exit-red bg-exit-red/10' : 'border-ink/25'}`}
            >
              <span className="font-display text-[15px]">{tCreateRoom('sourcesTmdbTitle')}</span>
              <span className="text-[11.5px] leading-snug opacity-70">{tCreateRoom('sourcesTmdbNote')}</span>
            </button>
          </div>

          <p className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/60">{tCreateRoom('trimTheBillLabel')}</p>
          <div className="mb-5 grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/60">
              {tCreateRoom('genreLabel')}
              <input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder={tCreateRoom('genrePlaceholder')}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/60">
              {tCreateRoom('minRatingLabel')}
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
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/60">
              {tCreateRoom('yearFromLabel')}
              <input
                type="number"
                value={yearMin}
                onChange={(e) => setYearMin(e.target.value)}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/60">
              {tCreateRoom('yearToLabel')}
              <input
                type="number"
                value={yearMax}
                onChange={(e) => setYearMax(e.target.value)}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
          </div>

          <div className="mb-4 flex items-center justify-between gap-4 border border-ink/28 bg-ink/5 p-3.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/62">{t('eligibleLabel')}</span>
            <span className="flex items-baseline gap-2" data-testid="solo-eligible-count">
              <span className={`font-display text-[30px] leading-none ${blocked ? 'text-exit-red' : 'text-ink'}`}>
                {eligibleCount === null ? '—' : eligibleCount}
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-widest text-ink/55">{t('titlesLabel')}</span>
            </span>
          </div>

          {blocked && (
            <p className="mb-3.5 border-l-[3px] border-exit-red py-2 pl-3 font-mono text-[11px] leading-relaxed text-exit-red">
              {t('tooFewWarning', { count: eligibleCount ?? 0, min: 5 })}
            </p>
          )}

          <button
            type="button"
            onClick={submitSolo}
            disabled={submitting || eligibleCount === null}
            data-testid="submit-solo"
            className="relative h-[62px] w-full overflow-hidden border-none font-display text-[clamp(17px,2vw,22px)] tracking-wide disabled:cursor-not-allowed"
            style={{
              background: submitting || eligibleCount === null || blocked ? 'rgba(34,24,18,.2)' : '#CF4436',
              color: submitting || eligibleCount === null || blocked ? 'rgba(34,24,18,.45)' : '#F3E9D2',
            }}
          >
            {submitting && (
              <span
                className="absolute inset-x-0 bottom-0 h-2.5"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(90deg, rgba(243,233,210,.35) 0 10px, transparent 10px 26px)',
                  animation: 'sprocket .9s linear infinite',
                }}
              />
            )}
            <span className="relative">{submitting ? t('submittingLabel') : t('submitLabel')}</span>
          </button>
          <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-widest text-ink/50">{t('noThresholdNote')}</p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="mt-3.5 w-full border border-dashed border-ink/40 bg-transparent p-3 font-mono text-[10.5px] uppercase tracking-[.18em] text-ink/75 hover:border-exit-red hover:text-exit-red"
          >
            {t('backToBoxOfficeLink')}
          </button>
        </div>
      </main>
    )
  }

  if (screen === 'shortlist') {
    return (
      <main className="mx-auto flex flex-1 max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-brass/35 pb-4">
          <div className="flex flex-col gap-1.5">
            <p className="font-mono text-[10.5px] uppercase tracking-[.34em] text-brass">{t('shortlistKicker')}</p>
            <h2 className="font-display text-[clamp(28px,5vw,52px)] leading-none tracking-wide text-ticket">{t('shortlistTitle')}</h2>
            <p className="font-mono text-[11px] tracking-wider text-ticket/60">{t('shortlistCountLabel', { count: shortlist.length })}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setScreen('filters')}
              className="border border-brass/55 px-4 py-3.5 font-mono text-[10.5px] uppercase tracking-widest text-ticket hover:border-marquee hover:text-marquee"
            >
              {t('adjustFiltersButton')}
            </button>
            <button
              type="button"
              onClick={surpriseMe}
              data-testid="surprise-me"
              className="bg-marquee px-6 py-3.5 font-display text-base text-ink hover:bg-marquee/90"
            >
              {t('surpriseMeButton')}
            </button>
          </div>
        </div>

        {degraded && (
          <div className="flex items-center gap-3 border border-dashed border-marquee/60 bg-marquee/[.07] px-4 py-3.5 font-mono text-[11px] leading-relaxed text-ticket/80">
            <span className="h-2.5 w-2.5 rounded-full bg-marquee" style={{ animation: 'bulb 1.6s ease-in-out infinite' }} />
            {t('degradedNotice')}
          </div>
        )}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(178px,1fr))] gap-4">
          {shortlist.map((entry, i) => (
            <div key={entry.movieId} className="flex flex-col border border-brass/35 bg-ink" data-testid="shortlist-card">
              <div className="relative box-border flex aspect-[2/3] items-end bg-velvet/40 p-2.5">
                {entry.posterPath && (
                  <img
                    className="absolute inset-0 h-full w-full object-cover"
                    src={entry.posterSource === 'plex' ? `/api/plex-image?movieId=${entry.movieId}` : `https://image.tmdb.org/t/p/w342${entry.posterPath}`}
                    alt={entry.title}
                  />
                )}
                <span className="absolute left-0 top-0 bg-marquee px-2.5 py-1 font-display text-[15px] text-ink">
                  {String(i + 1).padStart(2, '0')}
                </span>
                {entry.inLibrary && (
                  <span className="absolute bottom-0 right-0 bg-marquee/90 px-1.5 py-1 font-mono text-[8px] font-bold uppercase tracking-widest text-ink">
                    {t('onShelfBadge')}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1 px-3 pb-1.5 pt-2.5">
                <p className="font-display text-base leading-tight text-ticket">{entry.title}</p>
                <p className="font-mono text-[9.5px] uppercase tracking-wider text-brass">
                  {entry.year} · {entry.genres.join(', ')}
                </p>
                {entry.rating !== null && <p className="font-mono text-[10.5px] tracking-wider text-marquee">★ {entry.rating.toFixed(1)}</p>}
              </div>
              <button
                type="button"
                onClick={() => confirmPick(entry)}
                disabled={picking}
                className="mx-3 mb-3 border border-brass/55 py-2.5 font-mono text-[10px] uppercase tracking-[.2em] text-ticket transition-colors hover:border-marquee hover:bg-marquee hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('pickThisButton')}
              </button>
            </div>
          ))}
        </div>

        <p className="text-center font-mono text-[10px] uppercase tracking-widest text-brass/75">{t('footerNote')}</p>

        <SurpriseReveal
          visible={surpriseVisible}
          spinning={surpriseSpinning}
          card={surpriseCard}
          seenCount={seen.length}
          totalCount={shortlist.length}
          onWatchThis={() => surpriseCard && confirmPick(surpriseCard)}
          onReroll={surpriseMe}
          onClose={() => setSurpriseVisible(false)}
        />
      </main>
    )
  }

  // screen === 'pick'
  const picked = pickedCard
  if (!picked || !roomCode) return null
  const metaParts = [
    picked.year ? String(picked.year) : null,
    picked.genres.length > 0 ? picked.genres.join(', ').toLowerCase() : null,
    picked.rating !== null ? `★ ${picked.rating.toFixed(1)}` : null,
  ].filter((part): part is string => part !== null)

  return (
    <main className="mx-auto flex flex-1 max-w-3xl flex-col items-center gap-6 px-4 py-10 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[.45em] text-brass">{t('pickDimLabel')}</p>
      <div className="my-1">
        <CodeSlats code={picked.title.toUpperCase()} splitOn="space" />
      </div>
      <div className="flex w-full flex-wrap items-start justify-center gap-6 border-2 border-brass/60 bg-gradient-to-b from-velvet/70 to-ink/92 p-6 text-left sm:p-8">
        <div className="aspect-[2/3] w-[clamp(150px,22vw,200px)] flex-none bg-velvet/40">
          {picked.posterPath && (
            <img
              className="h-full w-full object-cover"
              src={picked.posterSource === 'plex' ? `/api/plex-image?movieId=${picked.movieId}` : `https://image.tmdb.org/t/p/w342${picked.posterPath}`}
              alt={picked.title}
            />
          )}
        </div>
        <div className="flex min-w-[260px] flex-1 flex-col gap-3">
          {metaParts.length > 0 && <p className="font-mono text-[11px] uppercase tracking-widest text-marquee">{metaParts.join(' · ')}</p>}
          {picked.overview && <p className="text-[15px] leading-relaxed text-ticket/78">{picked.overview}</p>}
          <p className="border border-dashed border-brass/45 px-2.5 py-2 font-mono text-[10px] uppercase tracking-widest text-brass/90" data-testid="solo-room-code">
            {t('writtenToHistory', { code: roomCode })}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={resetSolo} className="bg-marquee px-6 py-4 font-display text-[17px] text-ink hover:bg-marquee/90">
          {t('pickAgainButton')}
        </button>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="border border-brass/60 px-5 py-4 font-mono text-[11px] uppercase tracking-widest text-ticket hover:border-marquee hover:text-marquee"
        >
          {t('backToBoxOfficeLink')}
        </button>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-brass/70">{t('enjoyFooter')}</p>
    </main>
  )
}
