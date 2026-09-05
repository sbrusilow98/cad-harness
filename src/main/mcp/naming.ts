export const MAX_TOOL_NAME_LENGTH = 64

const INVALID_CHARS = /[^A-Za-z0-9_-]+/g

export interface ToolRef {
  serverId: string
  toolName: string
}

export function sanitizeToolName(raw: string): string {
  const cleaned = raw.trim().replace(INVALID_CHARS, '_').replace(/^_+|_+$/g, '')
  return cleaned.length > 0 ? cleaned : 'tool'
}

export function buildExposedName(prefix: string, toolName: string, maxLength = MAX_TOOL_NAME_LENGTH): string {
  const tool = sanitizeToolName(toolName)
  const pre = sanitizeToolName(prefix)
  const full = `${pre}__${tool}`
  if (full.length <= maxLength) return full
  const room = maxLength - tool.length - 2
  if (room >= 3) return `${pre.slice(0, room)}__${tool}`
  return tool.slice(0, maxLength)
}

export function uniqueName(
  base: string,
  taken: (name: string) => boolean,
  maxLength = MAX_TOOL_NAME_LENGTH
): string {
  if (!taken(base)) return base
  for (let i = 2; ; i++) {
    const suffix = `_${i}`
    const candidate = base.slice(0, maxLength - suffix.length) + suffix
    if (!taken(candidate)) return candidate
  }
}

export class ToolNameRegistry {
  private byExposed = new Map<string, ToolRef>()
  private byKey = new Map<string, string>()

  register(prefix: string, ref: ToolRef): string {
    const key = `${ref.serverId}::${ref.toolName}`
    const existing = this.byKey.get(key)
    if (existing) return existing
    const name = uniqueName(buildExposedName(prefix, ref.toolName), (n) => this.byExposed.has(n))
    this.byExposed.set(name, { ...ref })
    this.byKey.set(key, name)
    return name
  }

  resolve(exposed: string): ToolRef | undefined {
    return this.byExposed.get(exposed)
  }
}
