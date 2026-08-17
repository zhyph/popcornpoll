export interface PlexGuidSource {
  guid: string
  Guid?: { id: string }[]
}

function extractId(guid: string, prefix: string): string | null {
  if (!guid.startsWith(prefix)) return null
  const withoutPrefix = guid.slice(prefix.length)
  const withoutQuery = withoutPrefix.split('?')[0]
  return withoutQuery.length > 0 ? withoutQuery : null
}

export function parseGuid(item: PlexGuidSource): { tmdbId: number | null; imdbId: string | null } {
  const childIds = (item.Guid ?? []).map((g) => g.id)

  const tmdbFromChild = childIds.map((id) => extractId(id, 'tmdb://')).find((v) => v !== null)
  const imdbFromChild = childIds.map((id) => extractId(id, 'imdb://')).find((v) => v !== null)

  if (tmdbFromChild || imdbFromChild) {
    return {
      tmdbId: tmdbFromChild ? Number.parseInt(tmdbFromChild, 10) : null,
      imdbId: imdbFromChild ?? null,
    }
  }

  const legacyTmdb = extractId(item.guid, 'com.plexapp.agents.themoviedb://')
  if (legacyTmdb) {
    return { tmdbId: Number.parseInt(legacyTmdb, 10), imdbId: null }
  }

  const legacyImdb = extractId(item.guid, 'com.plexapp.agents.imdb://')
  if (legacyImdb) {
    return { tmdbId: null, imdbId: legacyImdb }
  }

  return { tmdbId: null, imdbId: null }
}
