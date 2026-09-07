import { describe, it, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startControlListener, type ControlListener } from './http'
import type { ControlDeps } from './deps'
import { DocumentService } from '../document-service'
import { RunService } from '../run-service'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

const TOKEN = 'a'.repeat(64)
let listener: ControlListener | null = null

function deps(): ControlDeps {
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

afterEach(async () => {
  await listener?.close()
  listener = null
})

describe('control listener', () => {
  it('serves MCP to a client that presents the token', async () => {
    listener = await startControlListener({ port: 0, token: TOKEN, deps: deps() })
    const transport = new StreamableHTTPClientTransport(new URL(listener.url), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } }
    })
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(transport)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('get_graph')
    await client.close()
  })

  it('rejects a missing or wrong token with 401', async () => {
    listener = await startControlListener({ port: 0, token: TOKEN, deps: deps() })
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

    const anonymous = await fetch(listener.url, { method: 'POST', headers, body })
    expect(anonymous.status).toBe(401)

    const wrong = await fetch(listener.url, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${'b'.repeat(64)}` },
      body
    })
    expect(wrong.status).toBe(401)
  })

  it('answers 404 away from the MCP path', async () => {
    listener = await startControlListener({ port: 0, token: TOKEN, deps: deps() })
    const response = await fetch(`${listener.url.replace('/mcp', '')}/elsewhere`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    })
    expect(response.status).toBe(404)
  })

  it('reports a port that is already taken', async () => {
    listener = await startControlListener({ port: 0, token: TOKEN, deps: deps() })
    await expect(startControlListener({ port: listener.port, token: TOKEN, deps: deps() })).rejects.toThrow(/EADDRINUSE|address already in use/i)
  })
})
