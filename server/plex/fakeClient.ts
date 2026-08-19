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
      // Two resources (one owned, with both a local and a remote connection;
      // one shared) so the setup screen's owner/shared badges and "local" vs
      // "remote" meta line are all visually exercised without real Plex —
      // matches the shape of Screen13-ProjectionBooth.dc.html's SERVERS demo
      // data (owned-local, owned-remote, shared-remote).
      return [
        {
          name: 'Fake Media Vault',
          clientIdentifier: 'fake-client-1',
          owned: true,
          product: 'Plex Media Server',
          productVersion: '1.41.3',
          connections: [
            { uri: 'http://fake-plex-local.local:32400', local: true },
            { uri: 'https://fake-plex-remote.example.net:32400', local: false },
          ],
        },
        {
          name: 'fake-shared-backup-node',
          clientIdentifier: 'fake-client-2',
          owned: false,
          product: 'Plex Media Server',
          productVersion: '1.40.2',
          connections: [{ uri: 'https://fake-plex-shared.example.net:32400', local: false }],
        },
      ]
    },
    async getLibrarySections() {
      // Matches Screen13-ProjectionBooth.dc.html's libraries demo data exactly.
      return [
        { id: '1', title: 'Movies', type: 'movie', count: 412 },
        { id: '2', title: 'Classics', type: 'movie', count: 88 },
        { id: '3', title: 'Kids', type: 'movie', count: 54 },
      ]
    },
    async getLibraryItems() {
      return FAKE_LIBRARY
    },
    async getThumb() {
      return { body: null, contentType: null, status: 404 }
    },
  }
}
