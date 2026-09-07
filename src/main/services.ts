import type { BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { IPC } from '@shared/ipc'
import type { RunEvent } from '@shared/events'
import type { Graph, ProviderId, ToolGrant } from '@shared/types'
import { errorMessage } from '@shared/errors'
import type { SettingsStore } from './settings'
import type { SecretStore } from './secrets'
import type { McpRegistry } from './mcp/registry'
import type { McpToolInfo } from './runtime/graph-tools'
import { getProvider, listModelsWithFallback } from './providers'
import { runGraph, type EngineDeps } from './runtime/engine'
import { parseGraphFile, serializeGraph } from './graph-files'
import { writeFileAtomic } from './fs-utils'
import { DocumentService } from './document-service'
import { RunService } from './run-service'
import { ControlManager } from './control/manager'
import type { ControlDeps } from './control/deps'

export interface ServiceInput {
  settings: SettingsStore
  secrets: SecretStore
  mcp: McpRegistry
  getWindows: () => BrowserWindow[]
}

export interface Services {
  document: DocumentService
  runs: RunService
  control: ControlManager
}

function workspaceIdFor(settings: SettingsStore, provider: ProviderId): string | undefined {
  return provider === 'anthropic' ? settings.get().anthropicWorkspaceId : undefined
}

async function collectMcpTools(
  input: ServiceInput,
  grants: ToolGrant[],
  signal?: AbortSignal
): Promise<{ tools: McpToolInfo[]; warnings: string[] }> {
  const tools: McpToolInfo[] = []
  const warnings: string[] = []
  const configured = input.settings.get().mcpServers
  for (const serverId of new Set(grants.map((g) => g.serverId))) {
    const config = configured.find((s) => s.id === serverId)
    if (!config) {
      warnings.push(`A node references MCP server "${serverId}", which is no longer configured; its tools were skipped.`)
      continue
    }
    try {
      tools.push(...(await input.mcp.listTools(serverId, signal)))
    } catch (err) {
      warnings.push(`Could not connect to MCP server "${config.name}": ${errorMessage(err)}`)
    }
  }
  return { tools, warnings }
}

export function createEngineDeps(input: ServiceInput, emit: (event: RunEvent) => void): EngineDeps {
  return {
    getProvider,
    getApiKey: async (id) => input.secrets.get(id),
    getWorkspaceId: (id) => workspaceIdFor(input.settings, id),
    listMcpTools: (grants, signal) => collectMcpTools(input, grants, signal),
    callMcpTool: (ref, args, signal) => input.mcp.callTool(ref, args, signal),
    limits: input.settings.get().limits,
    emit
  }
}

/** Builds the document mirror, the run service, and the remote-control manager over one app context. */
export function createServices(input: ServiceInput): Services {
  const send = (channel: string, payload: unknown): void => {
    for (const win of input.getWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  const document = new DocumentService((doc) => send(IPC.documentChanged, doc))

  const runs = new RunService({
    broadcast: (event) => send(IPC.runEvent, event),
    startRun: ({ runId, graph, input: message, signal, emit }) =>
      runGraph({ runId, graph, input: message, signal, deps: createEngineDeps(input, emit) })
  })

  const buildControlDeps = (): ControlDeps => ({
    document,
    runs,
    settings: { get: () => input.settings.get(), update: (patch) => input.settings.update(patch) },
    mcp: { test: (config) => input.mcp.test(config), invalidate: (serverId) => input.mcp.invalidate(serverId) },
    listModels: (provider) =>
      listModelsWithFallback(provider, input.secrets.get(provider), workspaceIdFor(input.settings, provider)),
    readGraphFile: async (path: string): Promise<Graph> => parseGraphFile(await readFile(path, 'utf8')),
    writeGraphFile: async (path: string, graph: Graph): Promise<void> => {
      writeFileAtomic(path, serializeGraph(graph))
    }
  })

  const control = new ControlManager({
    settings: { get: () => input.settings.get() },
    secrets: {
      get: (name) => input.secrets.get(name),
      set: (name, value) => input.secrets.set(name, value)
    },
    buildControlDeps
  })

  return { document, runs, control }
}
