import Database from 'better-sqlite3'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS: Array<{ version: number; file: string }> = [
  { version: 1, file: '001_init.sql' },
  { version: 2, file: '002_match_history.sql' },
  { version: 3, file: '003_match_history_drop_movie_fk.sql' },
]

export function runMigrations(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_version').all() as { version: number }[]).map(
      (row) => row.version,
    ),
  )

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    const sql = readFileSync(join(import.meta.dirname, 'migrations', migration.file), 'utf-8')
    const runMigration = db.transaction(() => {
      // 001_init.sql itself creates schema_version, which would collide with the
      // CREATE TABLE IF NOT EXISTS above on a fresh DB — strip that one statement.
      const withoutVersionTable = sql.replace(/CREATE TABLE schema_version[\s\S]*?;/, '')
      db.exec(withoutVersionTable)
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version)
    })
    runMigration()
  }
}

export function openDb(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true })
  const db = new Database(join(dataDir, 'popcornpoll.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}
