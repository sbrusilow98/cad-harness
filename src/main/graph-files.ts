import { DEFAULT_MODELS, PROVIDER_IDS, type AgentNode, type Graph, type GraphEdge, type ProviderId, type ToolGrant } from '@shared/types'

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function positiveInt(value: unknown): number | undefined {
  const n = num(value)
  return n !== undefined && n >= 1 ? Math.floor(n) : undefined
}

function normalizeGrant(raw: unknown): ToolGrant[] {
  if (!raw || typeof raw !== 'object') return []
  const r = raw as Record<string, unknown>
  const serverId = str(r['serverId'])
  if (!serverId) return []
  if (r['names'] === '*') return [{ serverId, names: '*' }]
  if (Array.isArray(r['names'])) return [{ serverId, names: r['names'].filter((n): n is string => typeof n === 'string') }]
  return []
}

function normalizeNode(raw: unknown, index: number): AgentNode {
  if (!raw || typeof raw !== 'object') throw new Error(`Node ${index + 1} is malformed.`)
  const r = raw as Record<string, unknown>
  const id = str(r['id'])
  if (!id) throw new Error(`Node ${index + 1} has no id.`)
  const provider: ProviderId = PROVIDER_IDS.includes(r['provider'] as ProviderId) ? (r['provider'] as ProviderId) : 'anthropic'
  const pos = (r['position'] && typeof r['position'] === 'object' ? r['position'] : {}) as Record<string, unknown>
  const node: AgentNode = {
    id,
    name: str(r['name']) ?? 'Agent',
    position: { x: num(pos['x']) ?? 0, y: num(pos['y']) ?? 0 },
    provider,
    model: str(r['model']) ?? DEFAULT_MODELS[provider],
    instructions: str(r['instructions']) ?? '',
    tools: Array.isArray(r['tools']) ? r['tools'].flatMap(normalizeGrant) : []
  }
  const temperature = num(r['temperature'])
  const maxTokens = positiveInt(r['maxTokens'])
  const maxTurns = positiveInt(r['maxTurns'])
  if (temperature !== undefined && temperature >= 0 && temperature <= 2) node.temperature = temperature
  if (maxTokens !== undefined) node.maxTokens = maxTokens
  if (maxTurns !== undefined) node.maxTurns = maxTurns
  return node
}

function normalizeEdge(raw: unknown): GraphEdge | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r['id'])
  const source = str(r['source'])
  const target = str(r['target'])
  if (!id || !source || !target) return null
  const edge: GraphEdge = { id, source, target, kind: r['kind'] === 'delegate' ? 'delegate' : 'handoff' }
  const description = str(r['description'])
  if (description) edge.description = description
  return edge
}

export function normalizeGraph(raw: unknown): Graph {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The file does not contain a graph.')
  const r = raw as Record<string, unknown>
  if (r['version'] !== 1) throw new Error(`Unsupported graph version: ${String(r['version'])}.`)
  if (!Array.isArray(r['nodes']) || !Array.isArray(r['edges'])) throw new Error('The graph is missing nodes or edges.')
  const seenIds = new Set<string>()
  const nodes = r['nodes'].map(normalizeNode).filter((n) => {
    if (seenIds.has(n.id)) return false
    seenIds.add(n.id)
    return true
  })
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = r['edges']
    .map(normalizeEdge)
    .filter((e): e is GraphEdge => e !== null && nodeIds.has(e.source) && nodeIds.has(e.target))
  const entry = str(r['entryNodeId'])
  const name = str(r['name'])
  return {
    version: 1,
    name: name && name.trim() ? name : 'Untitled',
    entryNodeId: entry && nodes.some((n) => n.id === entry) ? entry : null,
    nodes,
    edges
  }
}

export function parseGraphFile(text: string): Graph {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  return normalizeGraph(raw)
}

export function serializeGraph(graph: Graph): string {
  return JSON.stringify(graph, null, 2) + '\n'
}
