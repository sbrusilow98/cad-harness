import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServerConfig } from '@shared/types'
import type { McpToolInfo } from '../runtime/graph-tools'
import type { ToolRef } from './naming'

export type TransportFactory = (config: McpServerConfig) => Transport

const TOOL_CALL_TIMEOUT_MS = 10 * 60 * 1000
const EXTRA_PATH = ['/usr/local/bin', '/opt/homebrew/bin', `${process.env['HOME'] ?? ''}/.local/bin`, `${process.env['HOME'] ?? ''}/.cargo/bin`]

export function defaultTransportFactory(config: McpServerConfig): Transport {
  if (config.transport === 'stdio') {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) if (typeof value === 'string') env[key] = value
    env['PATH'] = [env['PATH'] ?? '', ...EXTRA_PATH].filter(Boolean).join(':')
    Object.assign(env, config.env ?? {})
    return new StdioClientTransport({ command: config.command, args: config.args, env, stderr: 'pipe' })
  }
  return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } })
}

export interface ToolCallOutcome {
  content: string
  isError: boolean
}

export function summarizeResult(result: unknown): ToolCallOutcome {
  const r = (result && typeof result === 'object' ? result : {}) as {
    content?: unknown
    isError?: unknown
    structuredContent?: unknown
  }
  const texts: string[] = []
  if (Array.isArray(r.content)) {
    for (const block of r.content) {
      if (!block || typeof block !== 'object') continue
      const b = block as { type?: string; text?: unknown; mimeType?: unknown; resource?: { uri?: unknown; text?: unknown } }
      if (b.type === 'text' && typeof b.text === 'string') {
        texts.push(b.text)
      } else if (b.type === 'image' || b.type === 'audio') {
        texts.push(`[${b.type}${typeof b.mimeType === 'string' ? ` ${b.mimeType}` : ''}]`)
      } else if (b.type === 'resource') {
        texts.push(`[resource${typeof b.resource?.uri === 'string' ? ` ${b.resource.uri}` : ''}]`)
        if (typeof b.resource?.text === 'string') texts.push(b.resource.text)
      } else if (typeof b.type === 'string') {
        texts.push(`[${b.type}]`)
      }
    }
  }
  if (texts.length === 0 && r.structuredContent !== undefined) texts.push(JSON.stringify(r.structuredContent))
  return { content: texts.join('\n'), isError: r.isError === true }
}

export class McpRegistry {
  private clients = new Map<string, Promise<Client>>()

  constructor(
    private readonly getConfigs: () => McpServerConfig[],
    private readonly transportFactory: TransportFactory = defaultTransportFactory
  ) {}

  private configFor(serverId: string): McpServerConfig {
    const config = this.getConfigs().find((c) => c.id === serverId)
    if (!config) throw new Error('MCP server is not configured.')
    return config
  }

  private async connect(config: McpServerConfig): Promise<Client> {
    const client = new Client({ name: 'agent-graph', version: '0.1.0' })
    await client.connect(this.transportFactory(config))
    return client
  }

  private clientFor(serverId: string): Promise<Client> {
    const existing = this.clients.get(serverId)
    if (existing) return existing
    const config = this.configFor(serverId)
    const pending = this.connect(config).catch((err: unknown) => {
      this.clients.delete(serverId)
      throw err
    })
    this.clients.set(serverId, pending)
    return pending
  }

  private async toolsOf(client: Client, config: McpServerConfig): Promise<McpToolInfo[]> {
    const { tools } = await client.listTools()
    return tools.map((t) => ({
      serverId: config.id,
      serverName: config.name,
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema as Record<string, unknown>
    }))
  }

  async listTools(serverId: string): Promise<McpToolInfo[]> {
    const config = this.configFor(serverId)
    const client = await this.clientFor(serverId)
    return this.toolsOf(client, config)
  }

  async callTool(ref: ToolRef, args: unknown, signal?: AbortSignal): Promise<ToolCallOutcome> {
    const client = await this.clientFor(ref.serverId)
    const result = await client.callTool(
      { name: ref.toolName, arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown> },
      undefined,
      { signal, timeout: TOOL_CALL_TIMEOUT_MS, resetTimeoutOnProgress: true }
    )
    return summarizeResult(result)
  }

  async test(config: McpServerConfig): Promise<McpToolInfo[]> {
    const client = await this.connect(config)
    try {
      return await this.toolsOf(client, config)
    } finally {
      await client.close().catch(() => undefined)
    }
  }

  async invalidate(serverId: string): Promise<void> {
    const pending = this.clients.get(serverId)
    this.clients.delete(serverId)
    if (!pending) return
    try {
      const client = await pending
      await client.close()
    } catch {
      // already failed or closed
    }
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.clients.keys()]) await this.invalidate(id)
  }
}
