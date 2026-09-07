import { describe, it, expect } from 'vitest'
import { harness } from './test-harness'
import type { McpServerConfig } from '@shared/types'

describe('settings tools', () => {
  it('lists configured servers with env and header values redacted', async () => {
    const h = await harness()
    h.deps.settings.update({
      mcpServers: [
        { id: 's1', name: 'FreeCAD', transport: 'stdio', command: 'uvx', args: ['freecad-mcp'], env: { TOKEN: 'secret' } },
        { id: 's2', name: 'Remote', transport: 'http', url: 'https://x/mcp', headers: { Authorization: 'Bearer secret' } }
      ]
    })
    const result = await h.call('list_mcp_servers')
    const text = result.text
    expect(text).not.toContain('secret')
    expect(result.payload.servers[0]).toMatchObject({ id: 's1', name: 'FreeCAD', transport: 'stdio', command: 'uvx', envNames: ['TOKEN'] })
    expect(result.payload.servers[1]).toMatchObject({ id: 's2', transport: 'http', url: 'https://x/mcp', headerNames: ['Authorization'] })
  })

  it('adds a server only after a successful connection test', async () => {
    const tested: McpServerConfig[] = []
    const h = await harness({
      mcp: {
        invalidate: async () => undefined,
        test: async (config) => {
          tested.push(config)
          return [{ serverId: config.id, serverName: config.name, name: 'ping', description: 'Pings', inputSchema: { type: 'object' } }]
        }
      }
    })
    const result = await h.call('add_mcp_server', { name: 'Local', transport: 'stdio', command: 'npx', args: ['-y', 'thing'] })
    expect(result.isError).toBe(false)
    expect(result.payload).toMatchObject({ name: 'Local', tools: ['ping'] })
    expect(tested).toHaveLength(1)
    expect(h.deps.settings.get().mcpServers).toHaveLength(1)
  })

  it('rejects a server that fails to connect and does not save it', async () => {
    const h = await harness({
      mcp: {
        invalidate: async () => undefined,
        test: async () => {
          throw new Error('command not found')
        }
      }
    })
    const result = await h.call('add_mcp_server', { name: 'Broken', transport: 'stdio', command: 'nope' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('command not found')
    expect(h.deps.settings.get().mcpServers).toEqual([])
  })

  it('requires the fields that match the chosen transport', async () => {
    const h = await harness()
    expect((await h.call('add_mcp_server', { name: 'X', transport: 'stdio' })).text).toContain('command')
    expect((await h.call('add_mcp_server', { name: 'X', transport: 'http' })).text).toContain('url')
  })

  it('tests and removes a configured server by name', async () => {
    const h = await harness({
      mcp: {
        invalidate: async () => undefined,
        test: async (config) => [
          { serverId: config.id, serverName: config.name, name: 'ping', description: '', inputSchema: { type: 'object' } }
        ]
      }
    })
    h.deps.settings.update({
      mcpServers: [{ id: 's1', name: 'FreeCAD', transport: 'stdio', command: 'uvx', args: [] }]
    })
    const tested = await h.call('test_mcp_server', { server: 'FreeCAD' })
    expect(tested.payload.tools[0]).toMatchObject({ name: 'ping' })

    const removed = await h.call('remove_mcp_server', { server: 'FreeCAD' })
    expect(removed.payload).toEqual({ removedServerId: 's1' })
    expect(h.deps.settings.get().mcpServers).toEqual([])
    expect((await h.call('remove_mcp_server', { server: 'Ghost' })).isError).toBe(true)
  })

  it('lists models for a provider', async () => {
    const h = await harness()
    const result = await h.call('list_models', { provider: 'anthropic' })
    expect(result.payload).toMatchObject({ provider: 'anthropic', source: 'fallback', models: ['claude-opus-5'] })
  })
})
