import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServerConfig } from '@shared/types'
import type { McpToolInfo } from '../runtime/graph-tools'
import type { ToolRef } from './naming'

export type TransportFactory = (config: McpServerConfig) => Transport

const TOOL_CALL_TIMEOUT_MS = 10 * 60 * 1000
const CONNECT_TIMEOUT_MS = 15000

/**
 * The environment for a stdio server, with the directories a GUI app would otherwise miss.
 *
 * A double-clicked app inherits a bare login environment, not the shell's, so the tools people
 * configure (`npx`, `uvx`) are usually not on PATH. Everything here is platform-shaped: the
 * separator, the directories worth adding, and the name of the home variable all differ.
 */
export function buildStdioEnv(
  configEnv: Record<string, string> | undefined,
  base: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  const windows = platform === 'win32'
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) if (typeof value === 'string') env[key] = value

  // Windows environment names are case-insensitive, so the key we want may be spelled any way at all
  // ("Path" is the usual one). Find the real key rather than assuming a casing.
  const keyOf = (name: string): string =>
    (windows ? Object.keys(env).find((key) => key.toUpperCase() === name.toUpperCase()) : undefined) ?? name
  const valueOf = (name: string): string | undefined => env[keyOf(name)]

  // Extend whichever PATH key is already there, or the child would get both it and a second "PATH".
  const pathKey = keyOf('PATH')
  const home = windows ? valueOf('USERPROFILE') : valueOf('HOME')
  const extraPath: string[] = []
  if (windows) {
    const appData = valueOf('APPDATA')
    const localAppData = valueOf('LOCALAPPDATA')
    const programFiles = valueOf('ProgramFiles')
    if (appData) extraPath.push(`${appData}\\npm`) // where `npm i -g` puts npx.cmd and friends
    if (localAppData) extraPath.push(`${localAppData}\\Microsoft\\WindowsApps`)
    if (programFiles) extraPath.push(`${programFiles}\\nodejs`)
    if (home) extraPath.push(`${home}\\.local\\bin`, `${home}\\.cargo\\bin`)
  } else {
    extraPath.push('/usr/local/bin', '/opt/homebrew/bin')
    if (home) extraPath.push(`${home}/.local/bin`, `${home}/.cargo/bin`)
  }
  env[pathKey] = [env[pathKey] ?? '', ...extraPath].filter(Boolean).join(windows ? ';' : ':')

  for (const [key, value] of Object.entries(configEnv ?? {})) {
    // A config "Path" has to replace an inherited "PATH", not sit next to it.
    const existing = keyOf(key)
    if (existing !== key) delete env[existing]
    env[key] = value
  }
  return env
}

export function defaultTransportFactory(config: McpServerConfig): Transport {
  if (config.transport === 'stdio') {
    const env = buildStdioEnv(config.env)
    const transport = new StdioClientTransport({ command: config.command, args: config.args, env, stderr: 'pipe' })
    transport.stderr?.on('data', (chunk: Buffer) => console.error(`[mcp ${config.name}]`, String(chunk).trimEnd()))
    return transport
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
  const isError = r.isError === true
  if (isError && texts.length === 0) texts.push('Tool call failed with no error message.')
  return { content: texts.join('\n'), isError }
}

export class McpRegistry {
  private clients = new Map<string, Promise<Client>>()

  constructor(
    private readonly getConfigs: () => McpServerConfig[],
    private readonly transportFactory: TransportFactory = defaultTransportFactory
  ) {}

  private configFor(serverId: string): McpServerConfig {
    const config = this.getConfigs().find((c) => c.id === serverId)
    if (!config) throw new Error(`MCP server "${serverId}" is not configured.`)
    return config
  }

  private async connect(config: McpServerConfig, options?: { timeout: number }): Promise<Client> {
    const client = new Client({ name: 'agent-graph', version: '0.1.0' })
    await client.connect(this.transportFactory(config), options)
    return client
  }

  private clientFor(serverId: string): Promise<Client> {
    const existing = this.clients.get(serverId)
    if (existing) return existing
    const config = this.configFor(serverId)
    const pending: Promise<Client> = this.connect(config, { timeout: CONNECT_TIMEOUT_MS })
      .then((client) => {
        client.onclose = () => {
          if (this.clients.get(serverId) === pending) this.clients.delete(serverId)
        }
        return client
      })
      .catch((err: unknown) => {
        if (this.clients.get(serverId) === pending) this.clients.delete(serverId)
        throw err
      })
    this.clients.set(serverId, pending)
    return pending
  }

  private async toolsOf(client: Client, config: McpServerConfig, signal?: AbortSignal): Promise<McpToolInfo[]> {
    const { tools } = await client.listTools(undefined, { signal })
    return tools.map((t) => ({
      serverId: config.id,
      serverName: config.name,
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema as Record<string, unknown>
    }))
  }

  async listTools(serverId: string, signal?: AbortSignal): Promise<McpToolInfo[]> {
    const config = this.configFor(serverId)
    const client = await this.clientFor(serverId)
    return this.toolsOf(client, config, signal)
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
    const client = await this.connect(config, { timeout: CONNECT_TIMEOUT_MS })
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
    await Promise.all([...this.clients.keys()].map((id) => this.invalidate(id)))
  }
}
