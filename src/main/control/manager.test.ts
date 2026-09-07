import { describe, it, expect, afterEach } from 'vitest'
import { ControlManager, CONTROL_TOKEN_KEY } from './manager'
import type { ControlDeps } from './deps'
import { DocumentService } from '../document-service'
import { RunService } from '../run-service'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

function controlDeps(): ControlDeps {
  let settings: Settings = { ...DEFAULT_SETTINGS }
  return {
    document: new DocumentService(() => undefined),
    runs: new RunService({ startRun: () => new Promise(() => undefined), broadcast: () => undefined }),
    settings: {
      get: () => settings,
      update: (patch) => {
        settings = { ...settings, ...patch }
        return settings
      }
    },
    mcp: { test: async () => [], invalidate: async () => undefined },
    listModels: async () => ({ models: [], source: 'fallback' }),
    readGraphFile: async () => {
      throw new Error('not used')
    },
    writeGraphFile: async () => undefined
  }
}

interface Fixture {
  manager: ControlManager
  setSettings: (patch: Partial<Settings>) => void
  secrets: Map<string, string>
}

function fixture(): Fixture {
  let settings: Settings = { ...DEFAULT_SETTINGS, remoteControl: { enabled: false, port: 0 } }
  const secrets = new Map<string, string>()
  const manager = new ControlManager({
    settings: { get: () => settings },
    secrets: {
      get: (name) => secrets.get(name) ?? null,
      set: (name, value) => {
        secrets.set(name, value)
      }
    },
    buildControlDeps: controlDeps
  })
  return {
    manager,
    secrets,
    setSettings: (patch) => {
      settings = { ...settings, ...patch }
    }
  }
}

let open: ControlManager | null = null
afterEach(async () => {
  await open?.stop()
  open = null
})

describe('ControlManager', () => {
  it('stays stopped while remote control is disabled', async () => {
    const f = fixture()
    open = f.manager
    const status = await f.manager.sync()
    expect(status).toMatchObject({ enabled: false, url: null, error: null })
    expect(status.token).toHaveLength(64)
  })

  it('mints a token once and reuses it', async () => {
    const f = fixture()
    open = f.manager
    const first = await f.manager.sync()
    const second = await f.manager.sync()
    expect(second.token).toBe(first.token)
    expect(f.secrets.get(CONTROL_TOKEN_KEY)).toBe(first.token)
  })

  it('starts a listener when enabled and stops it when disabled', async () => {
    const f = fixture()
    open = f.manager
    f.setSettings({ remoteControl: { enabled: true, port: 0 } })
    const started = await f.manager.sync()
    expect(started.enabled).toBe(true)
    expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(started.error).toBeNull()

    const response = await fetch(started.url!, { method: 'POST' })
    expect(response.status).toBe(401)

    f.setSettings({ remoteControl: { enabled: false, port: 0 } })
    const stopped = await f.manager.sync()
    expect(stopped.url).toBeNull()
  })

  it('replaces the token and restarts the listener on regenerate', async () => {
    const f = fixture()
    open = f.manager
    f.setSettings({ remoteControl: { enabled: true, port: 0 } })
    const before = await f.manager.sync()
    const after = await f.manager.regenerateToken()
    expect(after.token).not.toBe(before.token)
    expect(after.url).not.toBeNull()
    expect(f.secrets.get(CONTROL_TOKEN_KEY)).toBe(after.token)
  })

  it('reports a bind failure without throwing', async () => {
    const first = fixture()
    open = first.manager
    first.setSettings({ remoteControl: { enabled: true, port: 0 } })
    const started = await first.manager.sync()
    const port = Number(new URL(started.url!).port)

    const second = fixture()
    second.setSettings({ remoteControl: { enabled: true, port } })
    const failed = await second.manager.sync()
    expect(failed.url).toBeNull()
    expect(failed.error).toMatch(/EADDRINUSE|address already in use/i)
    await second.manager.stop()
  })
})
