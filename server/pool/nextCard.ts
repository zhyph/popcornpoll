import { affinityWeight, genreAffinity, type GenreTally } from '../ranking/affinity'
import { reputationScore } from '../ranking/reputation'
import { weightedSample, type Rng } from '../ranking/rng'
import type { PoolEntry } from './buildPool'

export const TOP_K = 10

export function pickNextCard(
  pool: PoolEntry[],
  swipedMovieIds: Set<number>,
  tally: GenreTally,
  totalVotes: number,
  reputationC: number,
  reputationM: number,
  rng: Rng,
): number | null {
  const remaining = pool.filter((entry) => !swipedMovieIds.has(entry.movieId))
  if (remaining.length === 0) return null

  const weight = affinityWeight(totalVotes)
  const scored = remaining.map((entry) => ({
    entry,
    score:
      reputationScore(entry, reputationC, reputationM) + weight * genreAffinity(entry.genres, tally),
  }))
  scored.sort((a, b) => b.score - a.score)
  const topTen = scored.slice(0, TOP_K)
  const minScore = topTen[topTen.length - 1]!.score

  const picked = weightedSample(topTen, (item) => item.score - minScore, rng)
  return picked.entry.movieId
}
