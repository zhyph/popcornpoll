// server/plex/fakeClient.ts
import type { PlexClient, PlexItem } from './client'

// A fixed 10-title fixture set. Every guid is opaque (matches neither the
// tmdb:// nor imdb:// prefix `parseGuid` looks for), so synced rows land
// with tmdbId/imdbId both null — enrichment's `row.tmdbId === null` guard
// and the imdb-backfill query's `imdb_id IS NOT NULL` filter both skip
// these rows naturally, so no TMDB fixture is needed to keep this
// FAKE_EXTERNAL_APIS path fully network-free.
const FAKE_LIBRARY: PlexItem[] = [
  { ratingKey: '1', title: 'The Velvet Reel', year: 2011, genres: ['Comedy', 'Drama'], guid: 'plex://movie/fake-1' },
  { ratingKey: '2', title: 'Marquee Nights', year: 2015, genres: ['Romance', 'Comedy'], guid: 'plex://movie/fake-2' },
  { ratingKey: '3', title: 'Brass and Bone', year: 2008, genres: ['Action', 'Thriller'], guid: 'plex://movie/fake-3' },
  { ratingKey: '4', title: 'Ticket to Nowhere', year: 2019, genres: ['Drama'], guid: 'plex://movie/fake-4' },
  { ratingKey: '5', title: 'The Last Matinee', year: 2003, genres: ['Horror', 'Comedy'], guid: 'plex://movie/fake-5' },
  { ratingKey: '6', title: 'Popcorn Symphony', year: 2021, genres: ['Animation', 'Family'], guid: 'plex://movie/fake-6' },
  { ratingKey: '7', title: 'Curtain Call', year: 1997, genres: ['Drama', 'Mystery'], guid: 'plex://movie/fake-7' },
  { ratingKey: '8', title: 'Exit Row Seven', year: 2013, genres: ['Thriller'], guid: 'plex://movie/fake-8' },
  { ratingKey: '9', title: 'Neon Marquee', year: 2018, genres: ['Sci-Fi', 'Action'], guid: 'plex://movie/fake-9' },
  { ratingKey: '10', title: 'Reel to Reel', year: 2006, genres: ['Documentary'], guid: 'plex://movie/fake-10' },
]

export function createFakePlexClient(): PlexClient {
  return {
    async createPin() {
      return { id: 1, code: 'FAKE' }
    },
    async checkPin() {
      return { authToken: 'fake-token' }
    },
    async getResources() {
      return [
        { name: 'Fake Server', clientIdentifier: 'fake-client', connections: [{ uri: 'http://fake-plex.local' }] },
      ]
    },
    async getLibrarySections() {
      return [{ id: '1', title: 'Movies', type: 'movie' }]
    },
    async getLibraryItems() {
      return FAKE_LIBRARY
    },
    async getThumb() {
      return { body: null, contentType: null, status: 404 }
    },
  }
}
