import { describe, it, expect } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z } from 'zod'
import { McpRegistry, summarizeResult, buildStdioEnv } from './registry'
import type { McpServerConfig } from '@shared/types'

let connections = 0
let lastServerTransport: InMemoryTransport | null = null

function makeTransport(): Transport {
  connections++
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  server.registerTool('echo', { description: 'Echoes text', inputSchema: { text: z.string() } }, async ({ text }) => ({
    content: [{ type: 'text', text: `echo:${text}` }]
  }))
  server.registerTool('fail', { description: 'Always fails', inputSchema: {} }, async () => ({
    content: [{ type: 'text', text: 'nope' }],
    isError: true
  }))
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  lastServerTransport = serverTransport
  void server.connect(serverTransport)
  return clientTransport
}

const config: McpServerConfig = { id: 's1', name: 'Test Server', transport: 'stdio', command: 'unused', args: [] }

describe('McpRegistry', () => {
  it('lists tools with server metadata', async () => {
    const registry = new McpRegistry(() => [config], makeTransport)
    const tools = await registry.listTools('s1')
    expect(tools.map((t) => t.name)).toEqual(['echo', 'fail'])
    expect(tools[0]).toMatchObject({ serverId: 's1', serverName: 'Test Server', description: 'Echoes text' })
    expect(tools[0].inputSchema).toMatchObject({ type: 'object' })
    await registry.closeAll()
  })

  it('aborts a tool listing when the signal is already cancelled', async () => {
    const registry = new McpRegistry(() => [config], makeTransport)
    await expect(registry.listTools('s1', AbortSignal.abort())).rejects.toThrow()
    await registry.closeAll()
  })

  it('reuses one connection per server', async () => {
    connections = 0
    const registry = new McpRegistry(() => [config], makeTransport)
    await registry.listTools('s1')
    await registry.callTool({ serverId: 's1', toolName: 'echo' }, { text: 'hi' })
    expect(connections).toBe(1)
    await registry.invalidate('s1')
    await registry.listTools('s1')
    expect(connections).toBe(2)
    await registry.closeAll()
  })

  it('calls tools and reports errors', async () => {
    const registry = new McpRegistry(() => [config], makeTransport)
    expect(await registry.callTool({ serverId: 's1', toolName: 'echo' }, { text: 'hi' })).toEqual({ content: 'echo:hi', isError: false })
    expect(await registry.callTool({ serverId: 's1', toolName: 'fail' }, {})).toEqual({ content: 'nope', isError: true })
    await registry.closeAll()
  })

  it('rejects unknown servers', async () => {
    const registry = new McpRegistry(() => [], makeTransport)
    await expect(registry.listTools('nope')).rejects.toThrow(/not configured/)
  })

  it('tests a config without caching the connection', async () => {
    connections = 0
    const registry = new McpRegistry(() => [], makeTransport)
    const tools = await registry.test(config)
    expect(tools.map((t) => t.name)).toEqual(['echo', 'fail'])
    await expect(registry.listTools('s1')).rejects.toThrow(/not configured/)
    expect(connections).toBe(1)
  })

  it('reconnects after the server side closes the transport', async () => {
    connections = 0
    const registry = new McpRegistry(() => [config], makeTransport)
    await registry.listTools('s1')
    await lastServerTransport!.close()
    await new Promise((r) => setTimeout(r, 0))
    await registry.listTools('s1')
    expect(connections).toBe(2)
    await registry.closeAll()
  })

  it('retries the connection after a failed attempt', async () => {
    let calls = 0
    const flaky = (): Transport => {
      calls++
      if (calls === 1) throw new Error('spawn failed')
      return makeTransport()
    }
    const registry = new McpRegistry(() => [config], flaky)
    await expect(registry.listTools('s1')).rejects.toThrow('spawn failed')
    expect((await registry.listTools('s1')).map((t) => t.name)).toEqual(['echo', 'fail'])
    await registry.closeAll()
  })
})

describe('summarizeResult', () => {
  it('joins text blocks and summarizes other content', () => {
    expect(
      summarizeResult({
        content: [
          { type: 'text', text: 'a' },
          { type: 'image', data: '...', mimeType: 'image/png' },
          { type: 'resource', resource: { uri: 'file:///x', text: 'inner' } }
        ]
      })
    ).toEqual({ content: 'a\n[image image/png]\n[resource file:///x]\ninner', isError: false })
  })

  it('falls back to structured content', () => {
    expect(summarizeResult({ content: [], structuredContent: { ok: true } })).toEqual({ content: '{"ok":true}', isError: false })
  })

  it('handles empty and malformed results', () => {
    expect(summarizeResult({})).toEqual({ content: '', isError: false })
    expect(summarizeResult(null)).toEqual({ content: '', isError: false })
  })

  it('reports a placeholder message for an error with no text', () => {
    expect(summarizeResult({ isError: true, content: [] })).toEqual({ content: 'Tool call failed with no error message.', isError: true })
  })
})

describe('buildStdioEnv', () => {
  it('extends PATH and lets config values win', () => {
    const env = buildStdioEnv({ FOO: '2', PATH: '/custom' }, { PATH: '/bin', FOO: '1', HOME: '/Users/x' })
    expect(env).toEqual({ PATH: '/custom', FOO: '2', HOME: '/Users/x' })
  })

  it('appends tool directories to PATH', () => {
    const env = buildStdioEnv(undefined, { PATH: '/bin', HOME: '/Users/x' })
    expect(env['PATH']).toBe('/bin:/usr/local/bin:/opt/homebrew/bin:/Users/x/.local/bin:/Users/x/.cargo/bin')
  })

  it('omits home-relative directories when HOME is unset and drops non-string values', () => {
    const env = buildStdioEnv(undefined, { PATH: '', X: undefined })
    expect(env).toEqual({ PATH: '/usr/local/bin:/opt/homebrew/bin' })
  })
})
