import type Database from 'better-sqlite3'
import { findDistinctGenres } from '../db/movies'

export function createGenresHandler(db: Database.Database): (req: Request) => Promise<Response> {
  return async () => {
    return Response.json({ genres: findDistinctGenres(db) })
  }
}
