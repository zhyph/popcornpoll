import type { MatchThreshold } from './types'

export function evaluateThreshold(threshold: MatchThreshold, yesCount: number, frozenCount: number): boolean {
  switch (threshold.kind) {
    case 'all':
      return yesCount === frozenCount
    case 'majority':
      return yesCount > frozenCount / 2
    case 'atLeast':
      return yesCount >= threshold.n
  }
}

export function isValidThreshold(threshold: MatchThreshold, participantCount: number): boolean {
  if (threshold.kind !== 'atLeast') return true
  return threshold.n >= 1 && threshold.n <= participantCount
}

export function clampThreshold(threshold: MatchThreshold, participantCount: number): MatchThreshold {
  if (threshold.kind !== 'atLeast') return threshold
  return { kind: 'atLeast', n: Math.min(threshold.n, Math.max(participantCount, 1)) }
}
