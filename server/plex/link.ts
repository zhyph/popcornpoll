import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'

export class DecryptionError extends Error {}

export interface PlexLink {
  clientIdentifier: string
  serverUrl: string
  authToken: string
  librarySectionIds: string[]
  linkedAt: string
}

function deriveKey(key: string): Buffer {
  // Real HKDF (RFC 5869) via Node's built-in hkdfSync, per the spec's binding
  // "key derived via HKDF" requirement — not a plain hash. Empty salt is
  // standard practice when the input key material (AUTH_ENCRYPTION_KEY) is
  // already expected to be high-entropy; `info` provides domain separation
  // so this derivation can never collide with a key derived for another
  // purpose from the same secret.
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(key), Buffer.alloc(0), 'popcornpoll-plex-auth-token', 32),
  )
}

function encrypt(plaintext: string, key: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(key), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

function decrypt(encoded: string, key: string): string {
  try {
    const raw = Buffer.from(encoded, 'base64')
    const iv = raw.subarray(0, 12)
    const authTag = raw.subarray(12, 28)
    const encrypted = raw.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(key), iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8')
  } catch (err) {
    throw new DecryptionError('Failed to decrypt stored Plex token — AUTH_ENCRYPTION_KEY may have changed', {
      cause: err,
    })
  }
}

export function savePlexLink(db: Database.Database, key: string, link: PlexLink): void {
  db.prepare(
    `INSERT INTO plex_link (id, client_identifier, server_url, auth_token, library_section_ids, linked_at)
     VALUES (1, @clientIdentifier, @serverUrl, @authToken, @librarySectionIds, @linkedAt)
     ON CONFLICT(id) DO UPDATE SET
       client_identifier = excluded.client_identifier,
       server_url = excluded.server_url,
       auth_token = excluded.auth_token,
       library_section_ids = excluded.library_section_ids,
       linked_at = excluded.linked_at`,
  ).run({
    clientIdentifier: link.clientIdentifier,
    serverUrl: link.serverUrl,
    authToken: encrypt(link.authToken, key),
    librarySectionIds: JSON.stringify(link.librarySectionIds),
    linkedAt: link.linkedAt,
  })
}

export function getPlexLink(db: Database.Database, key: string): PlexLink | null {
  const raw = db.prepare('SELECT * FROM plex_link WHERE id = 1').get() as
    | Record<string, unknown>
    | undefined
  if (!raw) return null
  return {
    clientIdentifier: raw.client_identifier as string,
    serverUrl: raw.server_url as string,
    authToken: decrypt(raw.auth_token as string, key),
    librarySectionIds: JSON.parse(raw.library_section_ids as string),
    linkedAt: raw.linked_at as string,
  }
}

export function clearPlexLink(db: Database.Database): void {
  db.prepare('DELETE FROM plex_link WHERE id = 1').run()
}
