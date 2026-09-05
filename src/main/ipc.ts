import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { IPC, type McpToolListResult, type McpToolSummary, type OpenedGraph } from '@shared/ipc'
import type { Graph, McpServerConfig, ProviderId, Settings, ToolGrant } from '@shared/types'
import type { RunEvent } from '@shared/events'
import type { SettingsStore } from './settings'
import type { SecretStore } from './secrets'
import type { McpRegistry } from './mcp/registry'
import { parseGraphFile, serializeGraph } from './graph-files'
import { getProvider, listModelsWithFallback } from './providers'
import { errorMessage, runGraph, type EngineDeps } from './runtime/engine'
import type { McpToolInfo } from './runtime/graph-tools'
import { writeFileAtomic } from './fs-utils'

export interface MainContext {
  settings: SettingsStore
  secrets: SecretStore
  mcp: McpRegistry
  getWindow: () => BrowserWindow | null
}

const GRAPH_FILTERS = [{ name: 'Agent Graph', extensions: ['json'] }]
const MAX_RECENT = 10

function safeFileName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '-')
  return cleaned || 'graph'
}

function rememberRecent(settings: SettingsStore, path: string): void {
  const recent = [path, ...settings.get().recentFiles.filter((p) => p !== path)].slice(0, MAX_RECENT)
  settings.update({ recentFiles: recent })
}

function summary(tool: McpToolInfo): McpToolSummary {
  return { name: tool.name, description: tool.description }
}

async function collectMcpTools(ctx: MainContext, grants: ToolGrant[]): Promise<{ tools: McpToolInfo[]; warnings: string[] }> {
  const tools: McpToolInfo[] = []
  const warnings: string[] = []
  const configured = ctx.settings.get().mcpServers
  for (const serverId of new Set(grants.map((g) => g.serverId))) {
    const config = configured.find((s) => s.id === serverId)
    if (!config) {
      warnings.push('A node references an MCP server that is no longer configured; its tools were skipped.')
      continue
    }
    try {
      tools.push(...(await ctx.mcp.listTools(serverId)))
    } catch (err) {
      warnings.push(`Could not connect to MCP server "${config.name}": ${errorMessage(err)}`)
    }
  }
  return { tools, warnings }
}

export function registerIpc(ctx: MainContext): void {
  const runs = new Map<string, AbortController>()

  ipcMain.handle(IPC.openGraph, async (): Promise<OpenedGraph | null> => {
    const win = ctx.getWindow()
    const options = { properties: ['openFile' as const], filters: GRAPH_FILTERS }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    const graph = parseGraphFile(await readFile(path, 'utf8'))
    rememberRecent(ctx.settings, path)
    return { path, graph }
  })

  ipcMain.handle(IPC.saveGraph, async (_event, graph: Graph, path: string | null): Promise<string | null> => {
    let target = path
    if (!target) {
      const win = ctx.getWindow()
      const options = { defaultPath: `${safeFileName(graph.name)}.agentgraph.json`, filters: GRAPH_FILTERS }
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      target = result.filePath
    }
    writeFileAtomic(target, serializeGraph(graph))
    rememberRecent(ctx.settings, target)
    return target
  })

  ipcMain.handle(IPC.getSettings, () => ctx.settings.get())

  ipcMain.handle(IPC.updateSettings, (_event, patch: Partial<Settings>) => {
    const before = ctx.settings.get()
    const after = ctx.settings.update(patch)
    for (const old of before.mcpServers) {
      const now = after.mcpServers.find((s) => s.id === old.id)
      if (!now || JSON.stringify(now) !== JSON.stringify(old)) void ctx.mcp.invalidate(old.id)
    }
    return after
  })

  ipcMain.handle(IPC.setSecret, (_event, provider: ProviderId, key: string) => {
    ctx.secrets.set(provider, key.trim())
  })
  ipcMain.handle(IPC.hasSecret, (_event, provider: ProviderId) => ctx.secrets.has(provider))
  ipcMain.handle(IPC.clearSecret, (_event, provider: ProviderId) => {
    ctx.secrets.clear(provider)
  })

  ipcMain.handle(IPC.listModels, (_event, provider: ProviderId) => listModelsWithFallback(provider, ctx.secrets.get(provider)))

  ipcMain.handle(IPC.testMcp, async (_event, config: McpServerConfig): Promise<McpToolListResult> => {
    try {
      const tools = await ctx.mcp.test(config)
      return { ok: true, tools: tools.map(summary) }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle(IPC.listMcpTools, async (_event, serverId: string): Promise<McpToolListResult> => {
    try {
      const tools = await ctx.mcp.listTools(serverId)
      return { ok: true, tools: tools.map(summary) }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle(IPC.startRun, (event, graph: Graph, input: string): string => {
    const runId = globalThis.crypto.randomUUID()
    const controller = new AbortController()
    runs.set(runId, controller)
    const sender = event.sender
    const emit = (e: RunEvent): void => {
      if (!sender.isDestroyed()) sender.send(IPC.runEvent, e)
    }
    const deps: EngineDeps = {
      getProvider,
      getApiKey: async (id) => ctx.secrets.get(id),
      listMcpTools: (grants) => collectMcpTools(ctx, grants),
      callMcpTool: (ref, args, signal) => ctx.mcp.callTool(ref, args, signal),
      limits: ctx.settings.get().limits,
      emit
    }
    void runGraph({ runId, graph, input, signal: controller.signal, deps }).finally(() => runs.delete(runId))
    return runId
  })

  ipcMain.handle(IPC.stopRun, (_event, runId: string) => {
    runs.get(runId)?.abort()
  })
}
