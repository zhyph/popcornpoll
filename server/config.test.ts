import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './config'

const validEnv = {
  TMDB_API_KEY: 'tmdb-key',
  AUTH_ENCRYPTION_KEY: 'a'.repeat(32),
  ADMIN_SETUP_TOKEN: 'setup-token',
  APP_ORIGIN: 'http://localhost:3000',
}

describe('loadConfig', () => {
  it('loads a valid config with defaults applied', () => {
    const config = loadConfig(validEnv)
    expect(config.tmdbApiKey).toBe('tmdb-key')
    expect(config.trustedProxyHops).toBe(0)
    expect(config.port).toBe(3000)
    expect(config.dataDir).toBe('./data')
  })

  it('respects explicit PORT, DATA_DIR, and TRUSTED_PROXY_HOPS', () => {
    const config = loadConfig({ ...validEnv, PORT: '4000', DATA_DIR: '/data', TRUSTED_PROXY_HOPS: '2' })
    expect(config.port).toBe(4000)
    expect(config.dataDir).toBe('/data')
    expect(config.trustedProxyHops).toBe(2)
  })

  it('throws ConfigError listing every missing required var', () => {
    expect(() => loadConfig({})).toThrow(ConfigError)
    try {
      loadConfig({})
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      const message = (err as Error).message
      expect(message).toContain('TMDB_API_KEY')
      expect(message).toContain('AUTH_ENCRYPTION_KEY')
      expect(message).toContain('ADMIN_SETUP_TOKEN')
      expect(message).toContain('APP_ORIGIN')
    }
  })
})
