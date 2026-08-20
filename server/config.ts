export class ConfigError extends Error {}

export interface AppConfig {
  tmdbApiKey: string
  authEncryptionKey: string
  adminSetupToken: string
  appOrigin: string
  trustedProxyHops: number
  port: number
  dataDir: string
}

const REQUIRED_VARS = ['TMDB_API_KEY', 'AUTH_ENCRYPTION_KEY', 'ADMIN_SETUP_TOKEN', 'APP_ORIGIN'] as const

// ADMIN_SETUP_TOKEN is the app's only administrative boundary — it gates the
// whole Plex link flow, including reading the Plex account token back out of
// pin-status. Refuse to boot on a token short enough to be worth guessing.
// 24 accepts the `openssl rand -hex 16` (32 chars) that .env.example and
// docker-compose.yml both recommend, and rejects the hand-typed ones.
const MIN_ADMIN_SETUP_TOKEN_LENGTH = 24

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const missing = REQUIRED_VARS.filter((key) => !env[key])
  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variable(s): ${missing.join(', ')}`)
  }

  const adminSetupToken = env.ADMIN_SETUP_TOKEN as string
  if (adminSetupToken.length < MIN_ADMIN_SETUP_TOKEN_LENGTH) {
    throw new ConfigError(
      `ADMIN_SETUP_TOKEN must be at least ${MIN_ADMIN_SETUP_TOKEN_LENGTH} characters ` +
        '(generate one with: openssl rand -hex 16)',
    )
  }

  return {
    tmdbApiKey: env.TMDB_API_KEY as string,
    authEncryptionKey: env.AUTH_ENCRYPTION_KEY as string,
    adminSetupToken,
    appOrigin: env.APP_ORIGIN as string,
    trustedProxyHops: env.TRUSTED_PROXY_HOPS ? Number.parseInt(env.TRUSTED_PROXY_HOPS, 10) : 0,
    port: env.PORT ? Number.parseInt(env.PORT, 10) : 3000,
    dataDir: env.DATA_DIR ?? './data',
  }
}
