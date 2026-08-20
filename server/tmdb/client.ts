export const TMDB_MIN_VOTE_COUNT = 200
export const TMDB_DISCOVER_PAGE_CAP = 5

export interface TmdbMovie {
  tmdbId: number
  title: string
  overview: string
  posterPath: string | null
  year: number | null
  genreIds: number[]
  rating: number
  voteCount: number
}

export interface TmdbClient {
  discoverMovies(
    filters: { genreId?: number; yearMin?: number; yearMax?: number; ratingMin?: number },
    pageCap: number,
  ): Promise<TmdbMovie[]>
  getMovieDetails(tmdbId: number): Promise<{ rating: number; voteCount: number } | null>
  findByImdbId(imdbId: string): Promise<number | null>
  // Fetched server-side rather than letting the browser hit image.tmdb.org
  // directly: participants' networks routinely can't reach the public TMDB
  // CDN (DNS/firewall/IPv6-only resolution), which left posters spinning
  // forever, while this server reaches it fine. See http/imageProxy.ts.
  getPosterImage(
    posterPath: string,
    width: number,
  ): Promise<{ body: ReadableStream | null; contentType: string | null; status: number }>
}

interface TmdbDiscoverResult {
  id: number
  title: string
  overview: string
  poster_path: string | null
  release_date: string
  genre_ids: number[]
  vote_average: number
  vote_count: number
}

function yearFromReleaseDate(date: string): number | null {
  const year = Number.parseInt(date.slice(0, 4), 10)
  return Number.isNaN(year) ? null : year
}

export function createTmdbClient(apiKey: string): TmdbClient {
  const base = 'https://api.themoviedb.org/3'

  return {
    async discoverMovies(filters, pageCap) {
      const movies: TmdbMovie[] = []
      for (let page = 1; page <= pageCap; page++) {
        const params = new URLSearchParams({
          api_key: apiKey,
          sort_by: 'vote_average.desc',
          'vote_count.gte': String(TMDB_MIN_VOTE_COUNT),
          page: String(page),
        })
        if (filters.genreId) params.set('with_genres', String(filters.genreId))
        if (filters.yearMin) params.set('primary_release_date.gte', `${filters.yearMin}-01-01`)
        if (filters.yearMax) params.set('primary_release_date.lte', `${filters.yearMax}-12-31`)
        if (filters.ratingMin) params.set('vote_average.gte', String(filters.ratingMin))

        const res = await fetch(`${base}/discover/movie?${params.toString()}`)
        if (!res.ok) {
          throw new Error(`TMDB discover request failed: ${res.status} ${res.statusText}`)
        }
        const body = (await res.json()) as { results: TmdbDiscoverResult[]; total_pages: number }
        for (const r of body.results) {
          movies.push({
            tmdbId: r.id,
            title: r.title,
            overview: r.overview,
            posterPath: r.poster_path,
            year: yearFromReleaseDate(r.release_date),
            genreIds: r.genre_ids,
            rating: r.vote_average,
            voteCount: r.vote_count,
          })
        }
        if (page >= body.total_pages) break
      }
      return movies
    },

    async getMovieDetails(tmdbId) {
      const params = new URLSearchParams({ api_key: apiKey })
      const res = await fetch(`${base}/movie/${tmdbId}?${params.toString()}`)
      if (!res.ok) return null
      const body = (await res.json()) as { vote_average: number; vote_count: number }
      return { rating: body.vote_average, voteCount: body.vote_count }
    },

    async findByImdbId(imdbId) {
      const params = new URLSearchParams({ api_key: apiKey, external_source: 'imdb_id' })
      const res = await fetch(`${base}/find/${imdbId}?${params.toString()}`)
      if (!res.ok) {
        throw new Error(`TMDB find request failed: ${res.status} ${res.statusText}`)
      }
      const body = (await res.json()) as { movie_results: { id: number }[] }
      return body.movie_results[0]?.id ?? null
    },

    async getPosterImage(posterPath, width) {
      // The image CDN is a different host from the JSON API and takes no
      // api_key. posterPath is interpolated straight into the URL, so it is
      // shape-checked here rather than trusted: it reaches this method from a
      // DB row, and the caller only asserts it is non-null. A stored value
      // carrying `?` or `#` would silently change what the CDN is asked for.
      // TMDB's own poster_path is always /<base62>.<ext>.
      if (!/^\/[A-Za-z0-9._-]+$/.test(posterPath)) {
        return { body: null, contentType: null, status: 400 }
      }
      const res = await fetch(`https://image.tmdb.org/t/p/w${width}${posterPath}`, {
        signal: AbortSignal.timeout(10_000),
      })
      return {
        body: res.body,
        contentType: res.headers.get('content-type'),
        status: res.status,
      }
    },
  }
}
