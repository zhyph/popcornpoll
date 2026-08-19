import { describe, expect, it } from 'vitest'
import { buildMetaParts } from './SurpriseReveal'
import type { PoolEntry } from '../server/pool/buildPool'

const card: PoolEntry = {
  movieId: 1,
  title: 'Double Feature',
  posterPath: null,
  posterSource: 'plex',
  overview: 'Two stories, one screen.',
  genres: ['Drama'],
  year: 1958,
  inLibrary: true,
  rating: 8.1,
  voteCount: 900,
}

describe('buildMetaParts', () => {
  it('joins year, lowercased genres, and rating for a full card', () => {
    expect(buildMetaParts(card)).toEqual(['1958', 'drama', '★ 8.1'])
  })

  it('omits a null year', () => {
    expect(buildMetaParts({ ...card, year: null })).toEqual(['drama', '★ 8.1'])
  })

  it('omits empty genres', () => {
    expect(buildMetaParts({ ...card, genres: [] })).toEqual(['1958', '★ 8.1'])
  })

  it('omits a null rating', () => {
    expect(buildMetaParts({ ...card, rating: null })).toEqual(['1958', 'drama'])
  })

  it('returns an empty array when card is null', () => {
    expect(buildMetaParts(null)).toEqual([])
  })
})
