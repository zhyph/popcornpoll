// messages/messages.test.ts
import { describe, expect, it } from 'vitest'
import ptBr from './pt-br.json'
import enUs from './en-us.json'

function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null ? keyPaths(value as Record<string, unknown>, path) : [path]
  })
}

describe('message dictionaries', () => {
  it('pt-br.json and en-us.json declare exactly the same keys', () => {
    expect(keyPaths(ptBr).sort()).toEqual(keyPaths(enUs).sort())
  })
})
