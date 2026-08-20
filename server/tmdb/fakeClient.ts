import type { TmdbClient, TmdbMovie } from './client'

// A small fixed fixture set, keeping FAKE_EXTERNAL_APIS mode fully
// network-free even for a plex+tmdb room (mirrors server/plex/fakeClient.ts's
// pattern/rationale).
const FAKE_DISCOVER_RESULTS: TmdbMovie[] = [
  {
    tmdbId: 90001,
    title: 'Static on the Marquee',
    overview: 'A fake TMDB discover fixture.',
    posterPath: '/fake-90001.jpg',
    year: 2017,
    genreIds: [878],
    rating: 7.4,
    voteCount: 3500,
  },
  {
    tmdbId: 90002,
    title: 'Understudy',
    overview: 'A fake TMDB discover fixture.',
    posterPath: '/fake-90002.jpg',
    year: 2012,
    genreIds: [18],
    rating: 6.8,
    voteCount: 1200,
  },
  {
    tmdbId: 90003,
    title: 'Second Feature',
    overview: 'A fake TMDB discover fixture.',
    posterPath: '/fake-90003.jpg',
    year: 2020,
    genreIds: [35],
    rating: 8.1,
    voteCount: 900,
  },
]

// A 1x1 transparent PNG. Fixture mode is network-free, but a poster
// endpoint that can only ever 502 means dev and e2e runs render zero
// posters — every poster-related bug is then invisible until someone
// points the app at a real Plex server. Real bytes, no network.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function onePixelImage() {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(ONE_PIXEL_PNG))
        controller.close()
      },
    }),
    contentType: 'image/png',
    status: 200,
  }
}

export function createFakeTmdbClient(): TmdbClient {
  return {
    async discoverMovies() {
      return FAKE_DISCOVER_RESULTS
    },
    async getMovieDetails(tmdbId) {
      const match = FAKE_DISCOVER_RESULTS.find((m) => m.tmdbId === tmdbId)
      return match ? { rating: match.rating, voteCount: match.voteCount } : null
    },
    async findByImdbId() {
      // The fake Plex fixture library's guids never carry an imdb:// prefix
      // (see server/plex/fakeClient.ts), so this path is never exercised in
      // fixture mode.
      return null
    },
    async getPosterImage() {
      return onePixelImage()
    },
  }
}
