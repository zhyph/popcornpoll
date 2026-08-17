export interface RatedCandidate {
  rating: number | null
  voteCount: number | null
}

const DEFAULT_C = 6.5
const DEFAULT_M = 50
const MIN_RATED_FOR_STATS = 30

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[index] ?? 0
}

export function computeCAndM(candidates: RatedCandidate[]): { c: number; m: number } {
  const rated = candidates.filter(
    (c): c is { rating: number; voteCount: number } => c.rating !== null && c.voteCount !== null,
  )
  if (rated.length < MIN_RATED_FOR_STATS) {
    return { c: DEFAULT_C, m: DEFAULT_M }
  }
  const c = rated.reduce((sum, r) => sum + r.rating, 0) / rated.length
  const voteCounts = rated.map((r) => r.voteCount).sort((a, b) => a - b)
  const m = percentile(voteCounts, 0.6)
  return { c, m }
}

export function reputationScore(candidate: RatedCandidate, c: number, m: number): number {
  if (candidate.rating === null || candidate.voteCount === null) return c
  const v = candidate.voteCount
  const r = candidate.rating
  return (v / (v + m)) * r + (m / (v + m)) * c
}
