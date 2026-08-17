import { describe, expect, it } from 'vitest'
import { parseGuid } from './guid'

describe('parseGuid', () => {
  it('modern agent: reads tmdb:// from the Guid[] child array', () => {
    const result = parseGuid({
      guid: 'plex://movie/5d7768ba96b0170020522ac9',
      Guid: [{ id: 'tmdb://438631' }, { id: 'imdb://tt1160419' }],
    })
    expect(result).toEqual({ tmdbId: 438631, imdbId: 'tt1160419' })
  })

  it('legacy themoviedb agent: parses the top-level guid, stripping the query suffix', () => {
    const result = parseGuid({ guid: 'com.plexapp.agents.themoviedb://278?lang=en' })
    expect(result).toEqual({ tmdbId: 278, imdbId: null })
  })

  it('legacy imdb agent: parses the top-level guid', () => {
    const result = parseGuid({ guid: 'com.plexapp.agents.imdb://tt0111161?lang=en' })
    expect(result).toEqual({ tmdbId: null, imdbId: 'tt0111161' })
  })

  it('manually-matched item: local:// guid has no external id', () => {
    const result = parseGuid({ guid: 'local://12345' })
    expect(result).toEqual({ tmdbId: null, imdbId: null })
  })

  it('modern agent with only an opaque plex:// guid and no Guid[] entries: no external id', () => {
    const result = parseGuid({ guid: 'plex://movie/5d7768ba96b0170020522ac9', Guid: [] })
    expect(result).toEqual({ tmdbId: null, imdbId: null })
  })

  it('modern agent with Guid[] present but no tmdb:// entry falls back to imdb:// in Guid[]', () => {
    const result = parseGuid({
      guid: 'plex://movie/5d7768ba96b0170020522ac9',
      Guid: [{ id: 'imdb://tt1160419' }],
    })
    expect(result).toEqual({ tmdbId: null, imdbId: 'tt1160419' })
  })
})
