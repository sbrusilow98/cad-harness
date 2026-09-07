import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildControlServer } from './server'
import type { ControlDeps } from './deps'
import { DocumentService } from '../document-service'
import { RunService } from '../run-service'
import { DEFAULT_SETTINGS, type Graph, type Settings } from '@shared/types'

export interface Harness {
  client: Client
  deps: ControlDeps
  files: Map<string, Graph>
  call: (name: string, args?: Record<string, unknown>) => Promise<{ isError: boolean; text: string; payload: any }>
}

/** Wires a real MCP client to the control server over the SDK's in-memory transport. */
export async function harness(overrides: Partial<ControlDeps> = {}): Promise<Harness> {
  const files = new Map<string, Graph>()
  let settings: Settings = { ...DEFAULT_SETTINGS }
  const deps: ControlDeps = {
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
    listModels: async () => ({ models: ['claude-opus-5'], source: 'fallback' }),
    readGraphFile: async (path) => {
      const graph = files.get(path)
      if (!graph) throw new Error(`no such file: ${path}`)
      return graph
    },
    writeGraphFile: async (path, graph) => {
      files.set(path, graph)
    },
    ...overrides
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = buildControlServer(deps)
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args })
    const content = (result.content as { type: string; text: string }[])[0]
    const text = content?.text ?? ''
    let payload: any = null
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
    return { isError: result.isError === true, text, payload }
  }

  return { client, deps, files, call }
}
