import type { Graph, McpServerConfig, ProviderId, Settings } from '@shared/types'
import type { ModelListResult } from '@shared/ipc'
import type { DocumentService } from '../document-service'
import type { RunService } from '../run-service'
import type { McpToolInfo } from '../runtime/graph-tools'

/**
 * Everything the control tools need, as an interface so they can be tested without Electron.
 * Nothing here can read or write a provider API key.
 */
export interface ControlDeps {
  document: DocumentService
  runs: RunService
  settings: {
    get(): Settings
    update(patch: Partial<Settings>): Settings
  }
  mcp: {
    test(config: McpServerConfig): Promise<McpToolInfo[]>
    invalidate(serverId: string): Promise<void>
  }
  listModels(provider: ProviderId): Promise<ModelListResult>
  readGraphFile(path: string): Promise<Graph>
  writeGraphFile(path: string, graph: Graph): Promise<void>
}
