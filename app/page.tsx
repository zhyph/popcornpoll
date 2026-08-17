// app/page.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Separator } from '../components/ui/separator'
import type { CandidateSource, MatchThreshold, TmdbFilters } from '../server/room/types'

export default function CreateRoomPage() {
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
    const body = await res.json()
    if (res.ok) {
      sessionStorage.setItem(`hostClaimToken:${body.roomCode}`, body.hostClaimToken)
      router.push(`/room/${body.roomCode}`)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-4">
      <h1 className="font-display text-5xl text-marquee">POPCORNPOLL</h1>
      <Card className="w-full border-2 border-brass bg-velvet">
        <CardHeader className="font-mono text-xs uppercase tracking-widest text-brass">
          Tonight's showing
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Candidate source</Label>
            <Select value={candidateSource} onValueChange={(v) => setCandidateSource(v as CandidateSource)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="plex">Plex library only</SelectItem>
                <SelectItem value="plex+tmdb">Plex + TMDB discover</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Match rule</Label>
            <Select value={thresholdKind} onValueChange={(v) => setThresholdKind(v as MatchThreshold['kind'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone must say yes</SelectItem>
                <SelectItem value="majority">Majority</SelectItem>
                <SelectItem value="atLeast">At least N</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {thresholdKind === 'atLeast' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="atLeastN">N</Label>
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
          <p className="font-mono text-xs uppercase tracking-widest text-brass">Filters</p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="genre">Genre</Label>
            <Input id="genre" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="e.g. Comedy" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="yearMin">Year, from</Label>
              <Input id="yearMin" type="number" value={yearMin} onChange={(e) => setYearMin(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="yearMax">Year, to</Label>
              <Input id="yearMax" type="number" value={yearMax} onChange={(e) => setYearMax(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ratingMin">Minimum rating</Label>
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
            Create room
          </Button>
          {candidateSource === 'plex+tmdb' && (
            <p className="text-center text-xs text-muted-foreground">
              This product uses the TMDB API but is not endorsed or certified by TMDB.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
