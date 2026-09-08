import type { Graph, McpServerConfig, ProviderId, Settings } from './types'
import type { RunEvent } from './events'

export const IPC = {
  openGraph: 'graph:open',
  saveGraph: 'graph:save',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  setSecret: 'secrets:set',
  hasSecret: 'secrets:has',
  clearSecret: 'secrets:clear',
  listModels: 'providers:listModels',
  testMcp: 'mcp:test',
  listMcpTools: 'mcp:tools',
  startRun: 'run:start',
  stopRun: 'run:stop',
  runEvent: 'run:event',
  syncDocument: 'document:sync',
  documentChanged: 'document:changed',
  controlStatus: 'control:status',
  regenerateControlToken: 'control:regenerateToken'
} as const

export interface McpToolSummary {
  name: string
  description: string
}

export type McpToolListResult = { ok: true; tools: McpToolSummary[] } | { ok: false; error: string }

export interface ModelListResult {
  models: string[]
  source: 'api' | 'fallback'
  error?: string
}

export interface DocumentPayload {
  graph: Graph
  path: string | null
  dirty: boolean
  revision: number
}

export interface ControlStatusPayload {
  enabled: boolean
  port: number
  url: string | null
  token: string
  error: string | null
}

export interface OpenedGraph {
  path: string
  graph: Graph
}

/** `process.platform`, narrowed to the three we ship for. Spelled out rather than taken from
 * `NodeJS.Platform` because the renderer's tsconfig does not pull in the node types. */
export type PlatformId = 'darwin' | 'win32' | 'linux'

export interface Api {
  /** The host platform, so the renderer can label shortcuts and reserve window-control space. */
  platform: PlatformId
  openGraph(): Promise<OpenedGraph | null>
  saveGraph(graph: Graph, path: string | null): Promise<string | null>
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  setSecret(provider: ProviderId, key: string): Promise<void>
  hasSecret(provider: ProviderId): Promise<boolean>
  clearSecret(provider: ProviderId): Promise<void>
  listModels(provider: ProviderId): Promise<ModelListResult>
  testMcpServer(config: McpServerConfig): Promise<McpToolListResult>
  listMcpTools(serverId: string): Promise<McpToolListResult>
  startRun(graph: Graph, input: string): Promise<string>
  stopRun(runId: string): Promise<void>
  onRunEvent(listener: (event: RunEvent) => void): () => void
  syncDocument(document: { graph: Graph; path: string | null; dirty: boolean }): void
  onDocumentChanged(listener: (document: DocumentPayload) => void): () => void
  getControlStatus(): Promise<ControlStatusPayload>
  regenerateControlToken(): Promise<ControlStatusPayload>
}

declare global {
  interface Window {
    api: Api
  }
}
