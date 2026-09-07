import { existsSync, readFileSync } from 'node:fs'
import {
  DEFAULT_REMOTE_CONTROL,
  DEFAULT_SETTINGS,
  type McpServerConfig,
  type RemoteControlSettings,
  type Settings
} from '@shared/types'
import { writeFileAtomic } from './fs-utils'

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string')
}

function isServerConfig(value: unknown): value is McpServerConfig {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v['id'] !== 'string' || typeof v['name'] !== 'string') return false
  if (v['transport'] === 'stdio') {
    if (typeof v['command'] !== 'string' || !Array.isArray(v['args'])) return false
    if (!v['args'].every((a): a is string => typeof a === 'string')) return false
    if (v['env'] !== undefined && !isStringRecord(v['env'])) return false
    return true
  }
  if (v['transport'] === 'http') {
    if (typeof v['url'] !== 'string') return false
    if (v['headers'] !== undefined && !isStringRecord(v['headers'])) return false
    return true
  }
  return false
}

export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>
  const limits = (r.limits && typeof r.limits === 'object' ? r.limits : {}) as Partial<Settings['limits']>
  const pick = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
  const remote = (r.remoteControl && typeof r.remoteControl === 'object' ? r.remoteControl : {}) as Partial<RemoteControlSettings>
  const port =
    typeof remote.port === 'number' && Number.isInteger(remote.port) && remote.port >= 1 && remote.port <= 65535
      ? remote.port
      : DEFAULT_REMOTE_CONTROL.port
  return {
    theme: r.theme === 'light' ? 'light' : 'dark',
    mcpServers: Array.isArray(r.mcpServers) ? r.mcpServers.filter(isServerConfig) : [],
    limits: {
      maxTurns: pick(limits.maxTurns, DEFAULT_SETTINGS.limits.maxTurns),
      maxDelegationDepth: pick(limits.maxDelegationDepth, DEFAULT_SETTINGS.limits.maxDelegationDepth),
      maxTotalSteps: pick(limits.maxTotalSteps, DEFAULT_SETTINGS.limits.maxTotalSteps)
    },
    remoteControl: { enabled: remote.enabled === true, port },
    recentFiles: Array.isArray(r.recentFiles) ? r.recentFiles.filter((f): f is string => typeof f === 'string') : [],
    ...(typeof r.anthropicWorkspaceId === 'string' && r.anthropicWorkspaceId.trim()
      ? { anthropicWorkspaceId: r.anthropicWorkspaceId.trim() }
      : {})
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
    const next = normalizeSettings({
      ...this.settings,
      ...patch,
      limits: { ...this.settings.limits, ...(patch.limits ?? {}) }
    })
    writeFileAtomic(this.filePath, JSON.stringify(next, null, 2))
    this.settings = next
    return this.settings
  }
}
