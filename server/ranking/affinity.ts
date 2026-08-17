export interface GenreTally {
  yes: Record<string, number>
  no: Record<string, number>
}

const ALPHA = 2
const MAX_WEIGHT = 1.5
const RAMP_VOTES = 20

export function emptyTally(): GenreTally {
  return { yes: {}, no: {} }
}

export function recordVote(tally: GenreTally, genres: string[], vote: 'yes' | 'no'): GenreTally {
  const next: GenreTally = { yes: { ...tally.yes }, no: { ...tally.no } }
  const bucket = vote === 'yes' ? next.yes : next.no
  for (const genre of genres) {
    bucket[genre] = (bucket[genre] ?? 0) + 1
  }
  return next
}

function singleGenreAffinity(genre: string, tally: GenreTally): number {
  const yes = tally.yes[genre] ?? 0
  const no = tally.no[genre] ?? 0
  return (yes - no) / (yes + no + 2 * ALPHA)
}

export function genreAffinity(candidateGenres: string[], tally: GenreTally): number {
  if (candidateGenres.length === 0) return 0
  const sum = candidateGenres.reduce((acc, g) => acc + singleGenreAffinity(g, tally), 0)
  return sum / candidateGenres.length
}

export function affinityWeight(totalVotes: number): number {
  return Math.min(totalVotes / RAMP_VOTES, 1) * MAX_WEIGHT
}
