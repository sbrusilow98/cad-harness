import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretStore, type Cipher } from './secrets'

const base64Cipher = (available = true): Cipher => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(Buffer.from(plain, 'utf8').toString('base64')),
  decrypt: (data) => Buffer.from(data.toString('utf8'), 'base64').toString('utf8')
})

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'agent-graph-')), 'secrets.bin')
}

describe('SecretStore', () => {
  it('stores and reads secrets through the cipher', () => {
    const path = tmpFile()
    const store = new SecretStore(path, base64Cipher())
    expect(store.has('anthropic')).toBe(false)
    store.set('anthropic', 'sk-123')
    expect(store.get('anthropic')).toBe('sk-123')
    expect(store.has('anthropic')).toBe(true)
    expect(readFileSync(path, 'utf8')).not.toContain('sk-123')
    expect(new SecretStore(path, base64Cipher()).get('anthropic')).toBe('sk-123')
  })

  it('clears secrets', () => {
    const path = tmpFile()
    const store = new SecretStore(path, base64Cipher())
    store.set('openai', 'x')
    store.clear('openai')
    expect(store.get('openai')).toBeNull()
    store.clear('never-set')
    expect(existsSync(path)).toBe(true)
  })

  it('refuses to store when encryption is unavailable', () => {
    const store = new SecretStore(tmpFile(), base64Cipher(false))
    expect(() => store.set('anthropic', 'k')).toThrow(/not available/)
    expect(store.get('anthropic')).toBeNull()
  })

  it('treats an unreadable file as empty', () => {
    const path = tmpFile()
    const store = new SecretStore(path, {
      isAvailable: () => true,
      encrypt: () => Buffer.from('garbage'),
      decrypt: () => {
        throw new Error('bad')
      }
    })
    store.set('a', 'b')
    expect(new SecretStore(path, base64Cipher()).get('a')).toBeNull()
  })
})
