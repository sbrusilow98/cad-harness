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
  runEvent: 'run:event'
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

export interface OpenedGraph {
  path: string
  graph: Graph
}

export interface Api {
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
}

declare global {
  interface Window {
    api: Api
  }
}
