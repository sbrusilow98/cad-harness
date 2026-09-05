import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
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
      recentFiles: ['a']
    })
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

  it('merges partial limit patches', () => {
    const store = new SettingsStore(tmpFile())
    store.update({ limits: { maxTurns: 1 } as never })
    expect(store.get().limits).toEqual({ maxTurns: 1, maxDelegationDepth: 5, maxTotalSteps: 200 })
  })
})
