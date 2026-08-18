import { describe, expect, it } from 'vitest'
import { resolveGenreId } from './genres'

describe('resolveGenreId', () => {
  it('resolves a canonical TMDB genre name case-insensitively, trimmed', () => {
    expect(resolveGenreId('Comedy')).toBe(35)
    expect(resolveGenreId('  drama ')).toBe(18)
  })

  it('resolves common alternate spellings to their canonical TMDB id', () => {
    expect(resolveGenreId('Sci-Fi')).toBe(878)
    expect(resolveGenreId('sci fi')).toBe(878)
  })

  it('returns undefined for an unrecognized or empty genre', () => {
    expect(resolveGenreId('Not A Genre')).toBeUndefined()
    expect(resolveGenreId('')).toBeUndefined()
    expect(resolveGenreId(undefined)).toBeUndefined()
  })
})
