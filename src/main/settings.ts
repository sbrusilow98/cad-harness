import { existsSync, readFileSync } from 'node:fs'
import { DEFAULT_SETTINGS, type McpServerConfig, type Settings } from '@shared/types'
import { writeFileAtomic } from './fs-utils'

function isServerConfig(value: unknown): value is McpServerConfig {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v['id'] !== 'string' || typeof v['name'] !== 'string') return false
  if (v['transport'] === 'stdio') return typeof v['command'] === 'string' && Array.isArray(v['args'])
  if (v['transport'] === 'http') return typeof v['url'] === 'string'
  return false
}

export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>
  const limits = (r.limits && typeof r.limits === 'object' ? r.limits : {}) as Partial<Settings['limits']>
  const pick = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
  return {
    theme: r.theme === 'light' ? 'light' : 'dark',
    mcpServers: Array.isArray(r.mcpServers) ? r.mcpServers.filter(isServerConfig) : [],
    limits: {
      maxTurns: pick(limits.maxTurns, DEFAULT_SETTINGS.limits.maxTurns),
      maxDelegationDepth: pick(limits.maxDelegationDepth, DEFAULT_SETTINGS.limits.maxDelegationDepth),
      maxTotalSteps: pick(limits.maxTotalSteps, DEFAULT_SETTINGS.limits.maxTotalSteps)
    },
    recentFiles: Array.isArray(r.recentFiles) ? r.recentFiles.filter((f): f is string => typeof f === 'string') : []
  }
}

export class SettingsStore {
  private settings: Settings

  constructor(private readonly filePath: string) {
    this.settings = this.load()
  }

  private load(): Settings {
    if (!existsSync(this.filePath)) return normalizeSettings({})
    try {
      return normalizeSettings(JSON.parse(readFileSync(this.filePath, 'utf8')))
    } catch {
      return normalizeSettings({})
    }
  }

  get(): Settings {
    return this.settings
  }

  update(patch: Partial<Settings>): Settings {
    this.settings = normalizeSettings({
      ...this.settings,
      ...patch,
      limits: { ...this.settings.limits, ...(patch.limits ?? {}) }
    })
    writeFileAtomic(this.filePath, JSON.stringify(this.settings, null, 2))
    return this.settings
  }
}
