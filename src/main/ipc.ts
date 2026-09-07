import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { IPC, type McpToolListResult, type McpToolSummary, type OpenedGraph } from '@shared/ipc'
import type { Graph, McpServerConfig, ProviderId, Settings } from '@shared/types'
import type { SettingsStore } from './settings'
import type { SecretStore } from './secrets'
import type { McpRegistry } from './mcp/registry'
import { parseGraphFile, serializeGraph } from './graph-files'
import { listModelsWithFallback } from './providers'
import { errorMessage } from '@shared/errors'
import type { McpToolInfo } from './runtime/graph-tools'
import { writeFileAtomic } from './fs-utils'
import type { DocumentService } from './document-service'
import type { RunService } from './run-service'
import type { ControlManager } from './control/manager'

export interface MainContext {
  settings: SettingsStore
  secrets: SecretStore
  mcp: McpRegistry
  document: DocumentService
  runs: RunService
  control: ControlManager
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

function connectionKey(config: McpServerConfig): string {
  if (config.transport === 'stdio') {
    return JSON.stringify({
      transport: config.transport,
      command: config.command,
      args: config.args,
      env: config.env
    })
  }
  return JSON.stringify({
    transport: config.transport,
    url: config.url,
    headers: config.headers
  })
}

export function registerIpc(ctx: MainContext): void {
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
      if (!now || connectionKey(now) !== connectionKey(old)) void ctx.mcp.invalidate(old.id)
    }
    if (JSON.stringify(before.remoteControl) !== JSON.stringify(after.remoteControl)) void ctx.control.sync()
    return after
  })

  ipcMain.handle(IPC.setSecret, (_event, provider: ProviderId, key: string) => {
    const trimmed = key.trim()
    if (!trimmed) {
      ctx.secrets.clear(provider)
    } else {
      ctx.secrets.set(provider, trimmed)
    }
  })
  ipcMain.handle(IPC.hasSecret, (_event, provider: ProviderId) => ctx.secrets.has(provider))
  ipcMain.handle(IPC.clearSecret, (_event, provider: ProviderId) => {
    ctx.secrets.clear(provider)
  })

  ipcMain.handle(IPC.listModels, (_event, provider: ProviderId) =>
    listModelsWithFallback(
      provider,
      ctx.secrets.get(provider),
      provider === 'anthropic' ? ctx.settings.get().anthropicWorkspaceId : undefined
    )
  )

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

  ipcMain.handle(IPC.startRun, (_event, graph: Graph, input: string): string => ctx.runs.start(graph, input))

  ipcMain.handle(IPC.stopRun, (_event, runId: string) => {
    ctx.runs.stop(runId)
  })

  ipcMain.on(IPC.syncDocument, (_event, document: { graph: Graph; path: string | null; dirty: boolean }) => {
    ctx.document.syncFromRenderer(document)
  })

  ipcMain.handle(IPC.controlStatus, () => ctx.control.status())
  ipcMain.handle(IPC.regenerateControlToken, () => ctx.control.regenerateToken())
}
