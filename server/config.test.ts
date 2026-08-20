import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './config'

const validEnv = {
  NODE_ENV: 'test' as const,
  TMDB_API_KEY: 'tmdb-key',
  AUTH_ENCRYPTION_KEY: 'a'.repeat(32),
  ADMIN_SETUP_TOKEN: 'a'.repeat(32),
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
    expect(() => loadConfig({ NODE_ENV: 'test' })).toThrow(ConfigError)
    try {
      loadConfig({ NODE_ENV: 'test' })
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      const message = (err as Error).message
      expect(message).toContain('TMDB_API_KEY')
      expect(message).toContain('AUTH_ENCRYPTION_KEY')
      expect(message).toContain('ADMIN_SETUP_TOKEN')
      expect(message).toContain('APP_ORIGIN')
    }
  })

  it('throws ConfigError on an ADMIN_SETUP_TOKEN below the minimum length', () => {
    expect(() => loadConfig({ ...validEnv, ADMIN_SETUP_TOKEN: 'admin' })).toThrow(ConfigError)
    expect(() => loadConfig({ ...validEnv, ADMIN_SETUP_TOKEN: 'a'.repeat(23) })).toThrow(ConfigError)
  })

  it('accepts an ADMIN_SETUP_TOKEN exactly at the minimum length', () => {
    const config = loadConfig({ ...validEnv, ADMIN_SETUP_TOKEN: 'a'.repeat(24) })
    expect(config.adminSetupToken).toBe('a'.repeat(24))
  })
})
