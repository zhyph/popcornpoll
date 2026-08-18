// app/setup/page.tsx
'use client'

import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Suspense, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Separator } from '../../components/ui/separator'
import { Skeleton } from '../../components/ui/skeleton'

interface PinResponse {
  id: number
  code: string
  clientIdentifier: string
}

interface PlexResource {
  name: string
  clientIdentifier: string
  connections: { uri: string }[]
}

interface LibrarySection {
  id: string
  title: string
  type: string
}

type Step = 'token' | 'pin' | 'polling' | 'servers' | 'sections' | 'done'

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
  const [step, setStep] = useState<Step>('token')
  const [pin, setPin] = useState<PinResponse | null>(null)
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [resources, setResources] = useState<PlexResource[]>([])
  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [sections, setSections] = useState<LibrarySection[]>([])
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-4 py-10">
      <h1 className="font-display text-4xl text-marquee">{t('title')}</h1>

      {step === 'token' && (
        <Card className="w-full border-2 border-brass bg-velvet">
          <CardHeader className="font-mono text-xs uppercase tracking-widest text-brass">
            {t('boxOffice')}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t('tokenExplainer')}</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="adminToken">{t('tokenLabel')}</Label>
              <Input
                id="adminToken"
                type="password"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                placeholder={t('tokenPlaceholder')}
                autoComplete="off"
              />
            </div>
            <Button
              className="bg-marquee text-ink hover:bg-marquee/90"
              disabled={adminToken.length === 0 || busy}
              onClick={() => {
                setStep('pin')
                void requestPin()
              }}
            >
              {t('startButton')}
            </Button>
          </CardContent>
        </Card>
      )}

      {(step === 'pin' || step === 'polling') && pin && (
        <Card className="w-full border-2 border-brass bg-velvet">
          <CardHeader className="font-mono text-xs uppercase tracking-widest text-brass">
            {t('linkPlexTitle')}
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <p className="font-mono text-3xl tracking-widest text-marquee">{pin.code}</p>
            <a
              href={`https://app.plex.tv/auth#?clientID=${encodeURIComponent(pin.clientIdentifier)}&code=${encodeURIComponent(pin.code)}&context%5Bdevice%5D%5Bproduct%5D=PopcornPoll`}
              target="_blank"
              rel="noreferrer"
              className="w-full"
            >
              <Button className="w-full bg-marquee text-ink hover:bg-marquee/90">{t('openPlexButton')}</Button>
            </a>
            {step === 'polling' && (
              <Badge variant="outline" className="animate-pulse border-brass text-brass">
                {t('waitingForApproval')}
              </Badge>
            )}
            <Button variant="ghost" className="text-exit-red hover:bg-exit-red/10" onClick={cancelPolling}>
              {t('cancelButton')}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'servers' && (
        <Card className="w-full border-2 border-brass bg-velvet">
          <CardHeader className="font-mono text-xs uppercase tracking-widest text-brass">
            {t('chooseServerTitle')}
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {busy && <Skeleton className="h-10 w-full" />}
            {!busy && resources.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('noServersFound')}</p>
            )}
            {resources.flatMap((resource) =>
              resource.connections.map((connection) => (
                <Button
                  key={connection.uri}
                  variant="outline"
                  className="justify-between border-brass text-ticket"
                  disabled={busy}
                  onClick={() => pickServer(connection.uri)}
                >
                  <span>{resource.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{connection.uri}</span>
                </Button>
              )),
            )}
          </CardContent>
        </Card>
      )}

      {step === 'sections' && (
        <Card className="w-full border-2 border-brass bg-velvet">
          <CardHeader className="font-mono text-xs uppercase tracking-widest text-brass">
            {t('chooseLibrariesTitle')}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {sections.length === 0 && <p className="text-sm text-muted-foreground">{t('noMovieLibraries')}</p>}
            {sections.map((section) => (
              <label key={section.id} className="flex items-center gap-2 text-ticket">
                <input
                  type="checkbox"
                  checked={selectedSectionIds.includes(section.id)}
                  onChange={() => toggleSection(section.id)}
                  className="h-4 w-4 accent-marquee"
                />
                {section.title}
              </label>
            ))}
            <Separator className="bg-brass/40" />
            <Button
              className="bg-marquee text-ink hover:bg-marquee/90"
              disabled={selectedSectionIds.length === 0 || busy}
              onClick={submitLink}
            >
              {t('finishButton')}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'done' && (
        <Card className="w-full border-2 border-brass bg-velvet">
          <CardHeader className="font-display text-2xl text-marquee">{t('successTitle')}</CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-ticket">{t('successMessage')}</p>
            <Button className="bg-marquee text-ink hover:bg-marquee/90" disabled={syncing} onClick={syncNow}>
              {syncing ? t('syncingButton') : t('syncNowButton')}
            </Button>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
