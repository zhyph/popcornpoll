// TMDB's fixed movie genre list (GET /genre/movie/list) — small and stable
// enough to hardcode rather than add a network round-trip/cache for a
// reference list that essentially never changes.
const TMDB_GENRE_IDS: Record<string, number> = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  'science fiction': 878,
  'tv movie': 10770,
  thriller: 53,
  war: 10752,
  western: 37,
}

// Common alternate spellings that don't exactly match TMDB's own genre name
// (e.g. the fake Plex fixture library and many real Plex agents use "Sci-Fi")
// but unambiguously mean the same genre.
const ALIASES: Record<string, string> = {
  'sci-fi': 'science fiction',
  scifi: 'science fiction',
  'sci fi': 'science fiction',
}

export function resolveGenreId(genre: string | undefined): number | undefined {
  if (!genre) return undefined
  const key = genre.trim().toLowerCase()
  if (!key) return undefined
  const canonical = ALIASES[key] ?? key
  return TMDB_GENRE_IDS[canonical]
}
