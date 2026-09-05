import { describe, it, expect } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z } from 'zod'
import { McpRegistry, summarizeResult } from './registry'
import type { McpServerConfig } from '@shared/types'

let connections = 0

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
})
