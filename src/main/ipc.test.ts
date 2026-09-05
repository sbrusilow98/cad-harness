import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { Graph, McpServerConfig } from '@shared/types'
import { emptyGraph, createAgentNode } from '@shared/graph-defaults'
import type { RunEvent } from '@shared/events'
import { registerIpc } from './ipc'
import { SettingsStore } from './settings'
import { SecretStore, type Cipher } from './secrets'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  showSaveDialog: vi.fn(),
  showOpenDialog: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      mocks.handlers.set(channel, fn)
    }
  },
  dialog: {
    showSaveDialog: mocks.showSaveDialog,
    showOpenDialog: mocks.showOpenDialog
  }
}))

const base64Cipher = (): Cipher => ({
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(Buffer.from(plain, 'utf8').toString('base64')),
  decrypt: (data) => Buffer.from(data.toString('utf8'), 'base64').toString('utf8')
})

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'agent-graph-ipc-'))
}

interface Sender {
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
}

function setup(): {
  settings: InstanceType<typeof SettingsStore>
  secrets: InstanceType<typeof SecretStore>
  registry: { listTools: ReturnType<typeof vi.fn>; callTool: ReturnType<typeof vi.fn>; test: ReturnType<typeof vi.fn>; invalidate: ReturnType<typeof vi.fn>; closeAll: ReturnType<typeof vi.fn> }
  sender: Sender
  event: { sender: Sender }
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
} {
  mocks.handlers.clear()
  mocks.showSaveDialog.mockReset().mockResolvedValue({ canceled: true })
  mocks.showOpenDialog.mockReset().mockResolvedValue({ canceled: true, filePaths: [] })

  const dir = tmpDir()
  const settings = new SettingsStore(join(dir, 'settings.json'))
  const secrets = new SecretStore(join(dir, 'secrets.bin'), base64Cipher())
  const registry = {
    listTools: vi.fn(async () => []),
    callTool: vi.fn(async () => ({ content: '', isError: false })),
    test: vi.fn(async () => []),
    invalidate: vi.fn(async () => undefined),
    closeAll: vi.fn(async () => undefined)
  }
  const sender: Sender = { isDestroyed: () => false, send: vi.fn() }
  const event = { sender }

  registerIpc({
    settings,
    secrets,
    mcp: registry as unknown as Parameters<typeof registerIpc>[0]['mcp'],
    getWindow: () => null
  })

  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = mocks.handlers.get(channel)
    if (!handler) throw new Error(`no handler registered for ${channel}`)
    return handler(event, ...args)
  }
  return { settings, secrets, registry, sender, event, invoke }
}

const stdio = (id: string, name: string, args: string[]): McpServerConfig => ({
  id,
  name,
  transport: 'stdio',
  command: 'npx',
  args
})

function runnableGraph(): Graph {
  const g = emptyGraph('Run me')
  g.nodes.push(createAgentNode({ x: 0, y: 0 }, { id: 'a', name: 'A' }))
  g.entryNodeId = 'a'
  return g
}

async function tick(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('settings:update', () => {
  it('invalidates only the servers whose connection details changed', async () => {
    const { settings, registry, invoke } = setup()
    settings.update({ mcpServers: [stdio('s1', 'One', ['x']), stdio('s2', 'Two', ['y']), stdio('s3', 'Three', ['z'])] })

    await invoke(IPC.updateSettings, {
      mcpServers: [stdio('s1', 'One renamed', ['x']), stdio('s2', 'Two', ['changed'])]
    })

    const invalidated = registry.invalidate.mock.calls.map((c) => c[0])
    expect(invalidated).not.toContain('s1')
    expect(invalidated).toContain('s2')
    expect(invalidated).toContain('s3')
    expect(invalidated).toHaveLength(2)
  })

  it('returns the normalized settings', async () => {
    const { invoke } = setup()
    const after = (await invoke(IPC.updateSettings, { theme: 'light' })) as { theme: string }
    expect(after.theme).toBe('light')
  })
})

describe('secrets:set', () => {
  it('stores a real key and clears the entry for a blank one', async () => {
    const { invoke } = setup()
    await invoke(IPC.setSecret, 'anthropic', 'sk-real')
    expect(await invoke(IPC.hasSecret, 'anthropic')).toBe(true)

    await invoke(IPC.setSecret, 'anthropic', '  ')
    expect(await invoke(IPC.hasSecret, 'anthropic')).toBe(false)
  })

  it('trims a stored key', async () => {
    const { secrets, invoke } = setup()
    await invoke(IPC.setSecret, 'openai', '  sk-padded  ')
    expect(secrets.get('openai')).toBe('sk-padded')
  })
})

describe('graph:save', () => {
  it('returns null when Save As is cancelled', async () => {
    const { invoke } = setup()
    expect(await invoke(IPC.saveGraph, runnableGraph(), null)).toBeNull()
    expect(mocks.showSaveDialog).toHaveBeenCalledTimes(1)
  })

  it('writes to a known path without opening a dialog', async () => {
    const { invoke, settings } = setup()
    const target = join(tmpDir(), 'graph.agentgraph.json')
    expect(await invoke(IPC.saveGraph, runnableGraph(), target)).toBe(target)
    expect(mocks.showSaveDialog).not.toHaveBeenCalled()
    expect(settings.get().recentFiles).toEqual([target])
  })
})

describe('run:start and run:stop', () => {
  it('returns a run id and reports the missing API key to the sender', async () => {
    const { sender, invoke } = setup()
    const runId = (await invoke(IPC.startRun, runnableGraph(), 'hello')) as string
    expect(typeof runId).toBe('string')
    expect(runId.length).toBeGreaterThan(0)

    await tick()
    const events = sender.send.mock.calls.map((c) => c[1] as RunEvent)
    expect(events[0]).toMatchObject({ type: 'run.started', runId })
    const last = events.at(-1) as { type: string; error: string }
    expect(last.type).toBe('run.error')
    expect(last.error).toMatch(/API key/)
  })

  it('ignores a stop for an unknown run id', async () => {
    const { invoke } = setup()
    await expect(invoke(IPC.stopRun, 'not-a-run')).resolves.toBeUndefined()
  })
})

describe('mcp handlers', () => {
  it('reports a failing server test as an error result', async () => {
    const { registry, invoke } = setup()
    registry.test.mockRejectedValueOnce(new Error('spawn failed'))
    expect(await invoke(IPC.testMcp, stdio('s1', 'One', []))).toEqual({ ok: false, error: 'spawn failed' })
  })

  it('summarizes a tool listing', async () => {
    const { registry, invoke } = setup()
    registry.listTools.mockResolvedValueOnce([
      { serverId: 's1', serverName: 'One', name: 'read', description: 'Reads', inputSchema: {} }
    ])
    expect(await invoke(IPC.listMcpTools, 's1')).toEqual({ ok: true, tools: [{ name: 'read', description: 'Reads' }] })
  })
})
