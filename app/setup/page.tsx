// app/setup/page.tsx
'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Suspense, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { SetupStepTracker, type Step } from '../../components/SetupStepTracker'

interface PinResponse {
  id: number
  code: string
  clientIdentifier: string
}

interface PlexResource {
  name: string
  clientIdentifier: string
  owned: boolean
  product: string
  productVersion: string
  connections: { uri: string; local: boolean }[]
}

interface LibrarySection {
  id: string
  title: string
  type: string
  count: number
}

const POLL_INTERVAL_MS = 2000
// Plex PINs are valid for roughly 15 minutes server-side; 5 minutes of
// silent client polling is a generous window before asking the owner to
// just generate a fresh code, rather than polling forever on a PIN that
// has quietly expired.
const POLL_TIMEOUT_MS = 5 * 60 * 1000

export default function SetupPage() {
  return (
    <Suspense fallback={<main className="p-8 font-mono text-brass">Loading…</main>}>
      <SetupFlow />
    </Suspense>
  )
}

function SetupFlow() {
  const t = useTranslations('setup')
  const searchParams = useSearchParams()

  const [adminToken, setAdminToken] = useState(searchParams.get('token') ?? '')
  // Starts at 'checking', not 'token': every previous visit to this page
  // forced the full token → Plex PIN → approve-in-Plex → pick server → pick
  // libraries flow from scratch, even for an owner who already linked and
  // just wants to trigger a resync — Plex's own OAuth approval step is the
  // real friction there, not this admin token. /api/stats needs no auth and
  // already reports plexLinked, so a quick probe on mount can skip straight
  // to a 'linked' landing state (just the admin token + Sync now) when
  // there's nothing left to link.
  const [step, setStep] = useState<Step>('checking')
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [pin, setPin] = useState<PinResponse | null>(null)
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [resources, setResources] = useState<PlexResource[]>([])
  // Highlights a server row on click without submitting — the mockup's
  // servers list is a genuine select, confirmed by the separate "Continue"
  // button below it, not immediate-submit-on-click.
  const [serverPick, setServerPick] = useState<string | null>(null)
  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [sections, setSections] = useState<LibrarySection[]>([])
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  // The PIN itself is a diagnostics-only detail per the design — the primary
  // flow never requires typing or copying it (the "OPEN PLEX TO AUTHORIZE"
  // link carries it automatically), so it stays collapsed by default.
  const [pinDetailsOpen, setPinDetailsOpen] = useState(false)

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollDeadline = useRef(0)

  function authHeaders(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${adminToken}`, ...extra }
  }

  function stopPolling() {
    if (pollTimer.current) clearInterval(pollTimer.current)
    pollTimer.current = null
  }

  // Belt-and-suspenders: also stop polling if the user navigates away
  // mid-flow, not just when the flow's own logic calls stopPolling().
  useEffect(() => () => stopPolling(), [])

  useEffect(() => {
    fetch('/api/stats')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { plexLinked: boolean; lastSyncAt: number | null } | null) => {
        setLastSyncAt(body?.lastSyncAt ?? null)
        setStep(body?.plexLinked ? 'linked' : 'token')
      })
      // A failed probe shouldn't strand the owner on a dead 'checking'
      // screen — fall back to the normal from-scratch flow, same as if
      // nothing were linked yet.
      .catch(() => setStep('token'))
  }, [])

  async function requestPin() {
    setBusy(true)
    try {
      const res = await fetch('/api/setup/plex/pin', { headers: authHeaders() })
      if (res.status === 401) {
        toast(t('unauthorizedError'))
        return
      }
      if (!res.ok) {
        toast(t('genericError'))
        return
      }
      const body = (await res.json()) as PinResponse
      setPin(body)
      startPolling(body)
    } finally {
      setBusy(false)
    }
  }

  function startPolling(activePin: PinResponse) {
    stopPolling()
    setStep('polling')
    pollDeadline.current = Date.now() + POLL_TIMEOUT_MS
    pollTimer.current = setInterval(async () => {
      if (Date.now() > pollDeadline.current) {
        stopPolling()
        toast(t('pollTimeoutError'))
        setStep('pin')
        return
      }
      const res = await fetch(`/api/setup/plex/pin-status?pinId=${activePin.id}`, { headers: authHeaders() })
      if (!res.ok) return // transient failure — keep polling until the deadline
      const body = (await res.json()) as { authToken: string | null }
      if (body.authToken) {
        stopPolling()
        setAuthToken(body.authToken)
        await loadResources(body.authToken)
      }
    }, POLL_INTERVAL_MS)
  }

  function cancelPolling() {
    stopPolling()
    setStep('pin')
  }

  async function loadResources(token: string) {
    const res = await fetch(`/api/setup/plex/resources?authToken=${encodeURIComponent(token)}`, {
      headers: authHeaders(),
    })
    if (!res.ok) {
      toast(t('genericError'))
      setStep('pin')
      return
    }
    const body = (await res.json()) as PlexResource[]
    setResources(body)
    setServerPick(null)
    setStep('servers')
  }

  async function pickServer(uri: string) {
    if (!authToken) return
    setBusy(true)
    try {
      const res = await fetch(
        `/api/setup/plex/library-sections?serverUrl=${encodeURIComponent(uri)}&authToken=${encodeURIComponent(authToken)}`,
        { headers: authHeaders() },
      )
      if (!res.ok) {
        toast(t('genericError'))
        return
      }
      const body = (await res.json()) as LibrarySection[]
      setServerUrl(uri)
      setSections(body)
      setSelectedSectionIds([])
      setStep('sections')
    } finally {
      setBusy(false)
    }
  }

  function toggleSection(id: string) {
    setSelectedSectionIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  async function submitLink() {
    if (!authToken || !serverUrl || !pin || selectedSectionIds.length === 0) return
    setBusy(true)
    try {
      const res = await fetch('/api/setup/plex/callback', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          authToken,
          serverUrl,
          librarySectionIds: selectedSectionIds,
          clientIdentifier: pin.clientIdentifier,
        }),
      })
      if (!res.ok) {
        toast(t('genericError'))
        return
      }
      setStep('done')
    } finally {
      setBusy(false)
    }
  }

  async function syncNow() {
    setSyncing(true)
    try {
      const res = await fetch('/api/setup/plex/resync', { method: 'POST', headers: authHeaders() })
      toast(res.ok ? t('syncTriggeredToast') : t('genericError'))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <main className="mx-auto grid max-w-4xl flex-1 grid-cols-1 gap-8 px-4 py-10 sm:grid-cols-2 sm:items-start">
      <div className="flex flex-col gap-4">
        <p className="font-mono text-[10.5px] uppercase tracking-[.3em] text-brass">{t('kickerLabel')}</p>
        <h1 className="font-display text-4xl text-ticket sm:text-5xl">{t('title')}</h1>
        <SetupStepTracker step={step} />
      </div>

      <div className="flex flex-col gap-5">
        {step === 'checking' && (
          <div className="border border-brass/40 p-5">
            <div className="h-10 w-full animate-pulse bg-brass/10" />
          </div>
        )}

        {step === 'linked' && (
          <div className="border-2 border-brass/60 bg-gradient-to-b from-velvet/80 to-ink/90 p-6 sm:p-8">
            <p className="mb-4 font-display text-2xl text-marquee">{t('alreadyLinkedTitle')}</p>
            <p className="mb-5 text-sm text-ticket/80">
              {lastSyncAt !== null
                ? t('alreadyLinkedSynced', { minutes: Math.max(0, Math.round((Date.now() - lastSyncAt) / 60_000)) })
                : t('alreadyLinkedSyncUnknown')}
            </p>
            <label className="mb-4 flex flex-col gap-1.5">
              <span className="font-mono text-xs uppercase tracking-wide text-brass/80">{t('tokenLabel')}</span>
              <input
                type="password"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                placeholder={t('tokenPlaceholder')}
                autoComplete="off"
                className="h-12 border-0 border-b-2 border-brass/40 bg-transparent font-mono text-ticket outline-none focus:border-exit-red"
              />
            </label>
            <button
              type="button"
              disabled={adminToken.length === 0 || syncing}
              onClick={syncNow}
              className="h-[52px] w-full bg-marquee font-display text-lg text-ink hover:bg-marquee/90 disabled:cursor-not-allowed disabled:bg-brass/20 disabled:text-ticket/40"
            >
              {syncing ? t('syncingButton') : t('syncNowButton')}
            </button>
            <button
              type="button"
              onClick={() => setStep('token')}
              className="mt-3 w-full border border-brass/50 py-3 font-mono text-xs uppercase tracking-widest text-ticket hover:border-marquee hover:text-marquee"
            >
              {t('relinkButton')}
            </button>
            <Link href="/">
              <span className="mt-4 block w-full text-center font-mono text-xs uppercase tracking-widest text-ticket hover:text-marquee hover:underline">
                {t('boxOffice')}
              </span>
            </Link>
          </div>
        )}

        {step === 'token' && (
          <div className="border-2 border-brass/60 bg-gradient-to-b from-velvet/80 to-ink/90 p-6 sm:p-8">
            <p className="mb-4 font-mono text-xs uppercase tracking-widest text-brass">{t('boxOffice')}</p>
            <p className="mb-4 text-sm text-ticket/70">{t('tokenExplainer')}</p>
            <label className="mb-4 flex flex-col gap-1.5">
              <span className="font-mono text-xs uppercase tracking-wide text-brass/80">{t('tokenLabel')}</span>
              <input
                type="password"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                placeholder={t('tokenPlaceholder')}
                autoComplete="off"
                className="h-12 border-0 border-b-2 border-brass/40 bg-transparent font-mono text-ticket outline-none focus:border-exit-red"
              />
            </label>
            <button
              type="button"
              disabled={adminToken.length === 0 || busy}
              onClick={() => {
                setStep('pin')
                void requestPin()
              }}
              className="h-[52px] w-full bg-marquee font-display text-lg text-ink hover:bg-marquee/90 disabled:cursor-not-allowed disabled:bg-brass/20 disabled:text-ticket/40"
            >
              {t('startButton')}
            </button>
          </div>
        )}

        {(step === 'pin' || step === 'polling') && pin && (
          <div className="border-2 border-brass/60 bg-gradient-to-b from-velvet/80 to-ink/90 p-6 sm:p-8">
            <p className="mb-2 text-center font-mono text-[10.5px] uppercase tracking-[.28em] text-brass">
              {t('linkPlexTitle')}
            </p>
            <h2 className="mb-4 text-center font-display text-2xl leading-tight text-ticket sm:text-[28px]">
              {t('approveHeading')}
            </h2>
            {step === 'polling' && (
              <p className="mx-auto mb-4 w-fit border border-brass/50 px-2.5 py-1.5 text-center font-mono text-[10px] uppercase tracking-widest text-brass" style={{ animation: 'flicker 2.4s ease-in-out infinite' }}>
                {t('waitingForApproval')}
              </p>
            )}
            <a
              href={`https://app.plex.tv/auth#?clientID=${encodeURIComponent(pin.clientIdentifier)}&code=${encodeURIComponent(pin.code)}&context%5Bdevice%5D%5Bproduct%5D=PopcornPoll`}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              <span className="block h-[52px] w-full bg-marquee text-center font-display text-lg leading-[52px] text-ink hover:bg-marquee/90">
                {t('openPlexButton')}
              </span>
            </a>
            {step === 'polling' && (
              <button
                type="button"
                onClick={cancelPolling}
                className="mt-2 w-full font-mono text-xs uppercase tracking-widest text-exit-red hover:underline"
              >
                {t('cancelButton')}
              </button>
            )}
            {step === 'pin' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void requestPin()}
                className="mt-2 w-full border border-brass/50 py-3 font-mono text-xs uppercase tracking-widest text-ticket hover:border-marquee hover:text-marquee"
              >
                {t('newCodeButton')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPinDetailsOpen((v) => !v)}
              className="mt-3 w-full text-center font-mono text-[10px] uppercase tracking-widest text-brass/80 underline decoration-brass/40 underline-offset-4 hover:text-ticket"
            >
              {pinDetailsOpen ? t('hidePinButton') : t('showPinButton')}
            </button>
            {pinDetailsOpen && (
              <div className="mt-3 border border-dashed border-brass/45 bg-ink/40 p-3.5">
                <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[.2em] text-brass/70">
                  {t('pinDiagnosticsLabel')}
                </p>
                <code className="block font-mono text-[11px] leading-relaxed text-ticket/80 [overflow-wrap:anywhere]">
                  {t('pinFormat', { id: pin.id, code: pin.code })}
                </code>
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-brass/70">{t('pinDiagnosticsHint')}</p>
              </div>
            )}
          </div>
        )}

        {step === 'servers' && (
          <div className="border border-brass/40 p-5">
            <p className="mb-4 font-mono text-xs uppercase tracking-widest text-brass">{t('chooseServerTitle')}</p>
            {busy && <div className="h-10 w-full animate-pulse bg-brass/10" />}
            {!busy && resources.length === 0 && <p className="text-sm text-ticket/60">{t('noServersFound')}</p>}
            <div className="flex flex-col gap-2.5">
              {resources.flatMap((resource) =>
                resource.connections.map((connection) => {
                  const selected = serverPick === connection.uri
                  const tag = resource.owned ? t('serverOwnedTag') : t('serverSharedTag')
                  const meta = resource.owned
                    ? connection.local
                      ? t('serverMetaOwnedLocal', { version: resource.productVersion })
                      : t('serverMetaOwnedRemote', { version: resource.productVersion })
                    : connection.local
                      ? t('serverMetaSharedLocal', { version: resource.productVersion })
                      : t('serverMetaSharedRemote', { version: resource.productVersion })
                  return (
                    <button
                      key={connection.uri}
                      type="button"
                      onClick={() => setServerPick(connection.uri)}
                      className={
                        selected
                          ? 'flex w-full flex-col gap-2 border border-marquee bg-marquee/10 px-4 py-4 text-left'
                          : 'flex w-full flex-col gap-2 border border-brass/35 px-4 py-4 text-left hover:border-marquee/60'
                      }
                    >
                      <span className="flex w-full items-start gap-3">
                        <span
                          aria-hidden
                          className={
                            selected
                              ? 'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-marquee bg-marquee'
                              : 'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-brass/60'
                          }
                        />
                        <span className="min-w-0 flex-1 font-mono text-[13px] leading-snug text-ticket [overflow-wrap:anywhere]">
                          {resource.name}
                        </span>
                        <span
                          className={
                            selected
                              ? 'shrink-0 border border-marquee/70 px-1.5 py-1 font-mono text-[9px] uppercase tracking-widest text-marquee'
                              : 'shrink-0 border border-brass/50 px-1.5 py-1 font-mono text-[9px] uppercase tracking-widest text-brass'
                          }
                        >
                          {tag}
                        </span>
                      </span>
                      <span className="block pl-[26px] font-mono text-[10px] leading-relaxed text-brass/95 [overflow-wrap:anywhere]">
                        {connection.uri}
                      </span>
                      <span className="block pl-[26px] font-mono text-[9.5px] uppercase tracking-widest text-ticket/45">
                        {meta}
                      </span>
                    </button>
                  )
                }),
              )}
            </div>
            <button
              type="button"
              disabled={!serverPick || busy}
              onClick={() => serverPick && pickServer(serverPick)}
              className="mt-4 h-[52px] w-full bg-marquee font-display text-lg text-ink hover:bg-marquee/90 disabled:cursor-not-allowed disabled:bg-brass/20 disabled:text-ticket/40"
            >
              {t('continueButton')}
            </button>
          </div>
        )}

        {step === 'sections' && (
          <div className="border border-brass/40 p-5">
            <p className="mb-4 font-mono text-xs uppercase tracking-widest text-brass">{t('chooseLibrariesTitle')}</p>
            {sections.length === 0 && <p className="text-sm text-ticket/60">{t('noMovieLibraries')}</p>}
            <div className="flex flex-col gap-3">
              {sections.map((section) => (
                <label key={section.id} className="flex cursor-pointer items-center gap-3 text-ticket">
                  <input
                    type="checkbox"
                    checked={selectedSectionIds.includes(section.id)}
                    onChange={() => toggleSection(section.id)}
                    className="h-4 w-4 shrink-0 cursor-pointer appearance-none border-2 border-brass/60 bg-transparent checked:border-marquee checked:bg-marquee"
                  />
                  <span className="font-mono text-[12.5px]">{section.title}</span>
                  <span className="ml-auto font-mono text-[10px] tracking-wide text-brass">
                    {t('titlesCount', { count: section.count })}
                  </span>
                </label>
              ))}
            </div>
            <div className="my-4 h-px bg-brass/30" />
            <button
              type="button"
              disabled={selectedSectionIds.length === 0 || busy}
              onClick={submitLink}
              className="min-h-[52px] w-full bg-marquee font-display text-lg text-ink hover:bg-marquee/90 disabled:cursor-not-allowed disabled:bg-brass/20 disabled:text-ticket/40 py-3"
            >
              {t('finishButton')}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="border-2 border-brass/60 bg-gradient-to-b from-velvet/80 to-ink/90 p-6 sm:p-8">
            <p className="mb-4 font-display text-2xl text-marquee">{t('successTitle')}</p>
            <p className="mb-5 text-sm text-ticket/80">{t('successMessage')}</p>
            <button
              type="button"
              disabled={syncing}
              onClick={syncNow}
              className="h-[52px] w-full bg-marquee font-display text-lg text-ink hover:bg-marquee/90 disabled:cursor-not-allowed disabled:bg-brass/20"
            >
              {syncing ? t('syncingButton') : t('syncNowButton')}
            </button>
            <Link href="/">
              <span className="mt-4 block w-full text-center font-mono text-xs uppercase tracking-widest text-ticket hover:text-marquee hover:underline">
                {t('boxOffice')}
              </span>
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}
