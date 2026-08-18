import { describe, expect, it } from 'vitest'
import { createFakeTmdbClient } from './fakeClient'

describe('createFakeTmdbClient', () => {
  it('discoverMovies returns a fixed fixture list without any network access', async () => {
    const client = createFakeTmdbClient()
    const movies = await client.discoverMovies({}, 5)
    expect(movies.length).toBeGreaterThan(0)
    expect(movies.every((m) => typeof m.tmdbId === 'number')).toBe(true)
  })

  it('getMovieDetails resolves rating/voteCount for a fixture tmdbId, null otherwise', async () => {
    const client = createFakeTmdbClient()
    const known = (await client.discoverMovies({}, 1))[0]!
    expect(await client.getMovieDetails(known.tmdbId)).toEqual({ rating: known.rating, voteCount: known.voteCount })
    expect(await client.getMovieDetails(999999)).toBeNull()
  })

  it('findByImdbId always returns null (fixture library has no imdb-prefixed guids)', async () => {
    const client = createFakeTmdbClient()
    expect(await client.findByImdbId('tt0000000')).toBeNull()
  })
})
