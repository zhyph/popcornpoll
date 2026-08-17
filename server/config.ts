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

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const missing = REQUIRED_VARS.filter((key) => !env[key])
  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variable(s): ${missing.join(', ')}`)
  }

  return {
    tmdbApiKey: env.TMDB_API_KEY as string,
    authEncryptionKey: env.AUTH_ENCRYPTION_KEY as string,
    adminSetupToken: env.ADMIN_SETUP_TOKEN as string,
    appOrigin: env.APP_ORIGIN as string,
    trustedProxyHops: env.TRUSTED_PROXY_HOPS ? Number.parseInt(env.TRUSTED_PROXY_HOPS, 10) : 0,
    port: env.PORT ? Number.parseInt(env.PORT, 10) : 3000,
    dataDir: env.DATA_DIR ?? './data',
  }
}
