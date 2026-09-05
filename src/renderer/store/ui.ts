import { create } from 'zustand'
import type { ProviderId, Settings, Theme } from '@shared/types'
import type { McpToolSummary, ModelListResult } from '@shared/ipc'
import { describeError } from '@/lib/errors'

export type Selection = { type: 'node'; id: string } | { type: 'edge'; id: string } | null

export interface ToolCacheEntry {
  status: 'loading' | 'ready' | 'error'
  tools: McpToolSummary[]
  error?: string
}

interface UiState {
  settings: Settings | null
  selection: Selection
  settingsOpen: boolean
  consoleOpen: boolean
  consoleHeight: number
  modelCache: Partial<Record<ProviderId, ModelListResult>>
  toolCache: Record<string, ToolCacheEntry>
  fitViewRequest: number
  loadSettings(): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  setTheme(theme: Theme): Promise<void>
  select(selection: Selection): void
  setSettingsOpen(open: boolean): void
  setConsoleOpen(open: boolean): void
  setConsoleHeight(height: number): void
  fetchModels(provider: ProviderId, force?: boolean): Promise<void>
  fetchTools(serverId: string, force?: boolean): Promise<void>
  requestFitView(): void
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme
}

export const useUiStore = create<UiState>((set, get) => ({
  settings: null,
  selection: null,
  settingsOpen: false,
  consoleOpen: false,
  consoleHeight: 320,
  modelCache: {},
  toolCache: {},
  fitViewRequest: 0,

  async loadSettings() {
    const settings = await window.api.getSettings()
    applyTheme(settings.theme)
    set({ settings })
  },

  async updateSettings(patch) {
    const previousServers = get().settings?.mcpServers ?? []
    const settings = await window.api.updateSettings(patch)
    applyTheme(settings.theme)
    const toolCache = { ...get().toolCache }
    if (patch.mcpServers) {
      for (const id of Object.keys(toolCache)) {
        const next = settings.mcpServers.find((s) => s.id === id)
        if (!next) {
          delete toolCache[id]
          continue
        }
        const prev = previousServers.find((s) => s.id === id)
        if (prev && JSON.stringify(prev) !== JSON.stringify(next)) delete toolCache[id]
      }
    }
    set({ settings, toolCache })
  },

  async setTheme(theme) {
    applyTheme(theme)
    await get().updateSettings({ theme })
  },

  select(selection) {
    set({ selection })
  },

  setSettingsOpen(settingsOpen) {
    set({ settingsOpen })
  },

  setConsoleOpen(consoleOpen) {
    set({ consoleOpen })
  },

  setConsoleHeight(height) {
    set({ consoleHeight: Math.min(Math.max(height, 140), Math.round(window.innerHeight * 0.7)) })
  },

  async fetchModels(provider, force = false) {
    if (!force && get().modelCache[provider]) return
    try {
      const result = await window.api.listModels(provider)
      set({ modelCache: { ...get().modelCache, [provider]: result } })
    } catch (err) {
      set({ modelCache: { ...get().modelCache, [provider]: { models: [], source: 'fallback', error: describeError(err) } } })
    }
  },

  async fetchTools(serverId, force = false) {
    const existing = get().toolCache[serverId]
    if (!force && existing && existing.status !== 'error') return
    set({ toolCache: { ...get().toolCache, [serverId]: { status: 'loading', tools: existing?.tools ?? [] } } })
    try {
      const result = await window.api.listMcpTools(serverId)
      const entry: ToolCacheEntry = result.ok
        ? { status: 'ready', tools: result.tools }
        : { status: 'error', tools: existing?.tools ?? [], error: result.error }
      set({ toolCache: { ...get().toolCache, [serverId]: entry } })
    } catch (err) {
      set({
        toolCache: {
          ...get().toolCache,
          [serverId]: { status: 'error', tools: existing?.tools ?? [], error: describeError(err) }
        }
      })
    }
  },

  requestFitView() {
    set({ fitViewRequest: get().fitViewRequest + 1 })
  }
}))
