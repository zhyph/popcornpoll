import { afterEach, describe, expect, it, vi } from 'vitest'
import { TMDB_MIN_VOTE_COUNT, createTmdbClient } from './client'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function mockFetchOnce(body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  }) as unknown as typeof fetch
}

describe('createTmdbClient', () => {
  it('discoverMovies requests vote_count.gte and sort_by=vote_average.desc, maps results', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 438631,
            title: 'Dune',
            overview: 'desc',
            poster_path: '/dune.jpg',
            release_date: '2021-10-21',
            genre_ids: [878],
            vote_average: 8.1,
            vote_count: 12000,
          },
        ],
        total_pages: 1,
      }),
    }) as unknown as typeof fetch

    const client = createTmdbClient('api-key')
    const movies = await client.discoverMovies({}, 5)
    expect(movies).toEqual([
      {
        tmdbId: 438631,
        title: 'Dune',
        overview: 'desc',
        posterPath: '/dune.jpg',
        year: 2021,
        genreIds: [878],
        rating: 8.1,
        voteCount: 12000,
      },
    ])
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain(`vote_count.gte=${TMDB_MIN_VOTE_COUNT}`)
    expect(calledUrl).toContain('sort_by=vote_average.desc')
  })

  it('discoverMovies stops at the page cap even if more pages exist', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], total_pages: 999 }),
    }) as unknown as typeof fetch
    const client = createTmdbClient('api-key')
    await client.discoverMovies({}, 3)
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
  })

  it('getMovieDetails returns rating/voteCount', async () => {
    mockFetchOnce({ vote_average: 7.2, vote_count: 900 })
    const client = createTmdbClient('api-key')
    const details = await client.getMovieDetails(278)
    expect(details).toEqual({ rating: 7.2, voteCount: 900 })
  })

  it('findByImdbId returns the tmdb id from /find, or null if no movie result', async () => {
    mockFetchOnce({ movie_results: [{ id: 278 }] })
    const client = createTmdbClient('api-key')
    expect(await client.findByImdbId('tt0111161')).toBe(278)

    mockFetchOnce({ movie_results: [] })
    expect(await client.findByImdbId('tt0000000')).toBeNull()
  })
})
