import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore, normalizeSettings } from './settings'
import { DEFAULT_SETTINGS } from '@shared/types'

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'agent-graph-')), 'nested', 'settings.json')
}

describe('normalizeSettings', () => {
  it('fills defaults for missing or invalid fields', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ theme: 'purple', limits: { maxTurns: 3 }, recentFiles: [1, 'a'] })).toEqual({
      theme: 'dark',
      mcpServers: [],
      limits: { maxTurns: 3, maxDelegationDepth: 5, maxTotalSteps: 200 },
      remoteControl: { enabled: false, port: 4820 },
      recentFiles: ['a']
    })
  })
})

describe('normalizeSettings mcpServers', () => {
  it('keeps well-formed servers and drops malformed ones', () => {
    const settings = normalizeSettings({
      mcpServers: [
        { id: 'a', name: 'A', transport: 'stdio', command: 'npx', args: ['-y', 'x'], env: { K: 'v' } },
        { id: 'b', name: 'B', transport: 'http', url: 'https://x', headers: { Authorization: 'Bearer t' } },
        { id: 'c', name: 'C', transport: 'stdio', command: 'npx', args: [1, 2] },
        { id: 'd', name: 'D', transport: 'http', url: 'https://x', headers: 'nope' },
        { id: 'e', name: 'E', transport: 'stdio', command: 'npx', args: [], env: { K: 1 } },
        { id: 'f', name: 'F', transport: 'carrier-pigeon' },
        { name: 'no id', transport: 'http', url: 'https://x' }
      ]
    })
    expect(settings.mcpServers.map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('SettingsStore', () => {
  it('starts with defaults when no file exists', () => {
    const store = new SettingsStore(tmpFile())
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists updates and reloads them', () => {
    const path = tmpFile()
    const store = new SettingsStore(path)
    const updated = store.update({ theme: 'light', limits: { ...DEFAULT_SETTINGS.limits, maxTurns: 7 } })
    expect(updated.theme).toBe('light')
    expect(updated.limits.maxTurns).toBe(7)
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8')).theme).toBe('light')
    expect(new SettingsStore(path).get()).toEqual(updated)
  })

  it('keeps the previous settings in memory when the write fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-graph-'))
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'not a directory')
    const store = new SettingsStore(join(blocker, 'settings.json'))
    expect(() => store.update({ theme: 'light' })).toThrow()
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('merges partial limit patches', () => {
    const store = new SettingsStore(tmpFile())
    store.update({ limits: { maxTurns: 1 } as never })
    expect(store.get().limits).toEqual({ maxTurns: 1, maxDelegationDepth: 5, maxTotalSteps: 200 })
  })
})

describe('normalizeSettings anthropicWorkspaceId', () => {
  it('keeps a trimmed workspace id and drops blank ones', () => {
    expect(normalizeSettings({ anthropicWorkspaceId: ' wrkspc_01 ' }).anthropicWorkspaceId).toBe('wrkspc_01')
    expect(normalizeSettings({ anthropicWorkspaceId: '   ' })).not.toHaveProperty('anthropicWorkspaceId')
    expect(normalizeSettings({ anthropicWorkspaceId: 42 })).not.toHaveProperty('anthropicWorkspaceId')
  })
})

describe('normalizeSettings remoteControl', () => {
  it('defaults to disabled on port 4820 and rejects a bad port', () => {
    expect(normalizeSettings({}).remoteControl).toEqual({ enabled: false, port: 4820 })
    expect(normalizeSettings({ remoteControl: { enabled: true, port: 5000 } }).remoteControl).toEqual({ enabled: true, port: 5000 })
    expect(normalizeSettings({ remoteControl: { enabled: 'yes', port: 0 } }).remoteControl).toEqual({ enabled: false, port: 4820 })
    expect(normalizeSettings({ remoteControl: { port: 70000 } }).remoteControl).toEqual({ enabled: false, port: 4820 })
  })
})
