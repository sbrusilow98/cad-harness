export type ProviderId = 'anthropic' | 'openai' | 'fireworks'

export const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'fireworks']

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  fireworks: 'Fireworks'
}

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-opus-5',
  openai: 'gpt-5',
  fireworks: 'accounts/fireworks/models/llama-v3p3-70b-instruct'
}

export interface Position {
  x: number
  y: number
}

export interface ToolGrant {
  serverId: string
  names: string[] | '*'
}

export interface AgentNode {
  id: string
  name: string
  position: Position
  provider: ProviderId
  model: string
  instructions: string
  tools: ToolGrant[]
  temperature?: number
  maxTokens?: number
  maxTurns?: number
}

export type EdgeKind = 'handoff' | 'delegate'

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  description?: string
}

export interface Graph {
  version: 1
  name: string
  entryNodeId: string | null
  nodes: AgentNode[]
  edges: GraphEdge[]
}

export type McpServerConfig = { id: string; name: string } & (
  | { transport: 'stdio'; command: string; args: string[]; env?: Record<string, string> }
  | { transport: 'http'; url: string; headers?: Record<string, string> }
)

export interface RunLimits {
  maxTurns: number
  maxDelegationDepth: number
  maxTotalSteps: number
}

export type Theme = 'light' | 'dark'

export interface RemoteControlSettings {
  enabled: boolean
  port: number
}

export const DEFAULT_REMOTE_CONTROL: RemoteControlSettings = { enabled: false, port: 4820 }

export interface Settings {
  theme: Theme
  mcpServers: McpServerConfig[]
  limits: RunLimits
  remoteControl: RemoteControlSettings
  recentFiles: string[]
  /** Required only for Anthropic API keys that are not scoped to a workspace. */
  anthropicWorkspaceId?: string
}

export const DEFAULT_LIMITS: RunLimits = { maxTurns: 25, maxDelegationDepth: 5, maxTotalSteps: 200 }

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  mcpServers: [],
  limits: DEFAULT_LIMITS,
  remoteControl: DEFAULT_REMOTE_CONTROL,
  recentFiles: []
}
