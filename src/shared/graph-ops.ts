import { DEFAULT_MODELS, type AgentNode, type EdgeKind, type Graph, type GraphEdge, type Position, type ProviderId, type ToolGrant } from './types'
import { createAgentNode, newId } from './graph-defaults'

export type OpsResult<T> = { ok: true; graph: Graph; value: T } | { ok: false; error: string }
export type Lookup<T> = { ok: true; value: T } | { ok: false; error: string }

export interface AgentSpec {
  name: string
  provider?: ProviderId
  model?: string
  instructions?: string
  tools?: ToolGrant[]
  position?: Position
  entry?: boolean
  temperature?: number
  maxTokens?: number
  maxTurns?: number
}

export type AgentPatch = Partial<Omit<AgentSpec, 'entry'>>

const COLUMNS = 4
const COLUMN_WIDTH = 280
const ROW_HEIGHT = 180
const ORIGIN = 80

/** Places a new agent in a tidy grid so a caller never has to supply coordinates. */
export function nextPosition(graph: Graph): Position {
  const index = graph.nodes.length
  return { x: ORIGIN + (index % COLUMNS) * COLUMN_WIDTH, y: ORIGIN + Math.floor(index / COLUMNS) * ROW_HEIGHT }
}

function normalize(reference: string): string {
  return reference.trim().toLowerCase()
}

export function resolveAgent(graph: Graph, reference: string): Lookup<AgentNode> {
  const byId = graph.nodes.find((n) => n.id === reference.trim())
  if (byId) return { ok: true, value: byId }
  const matches = graph.nodes.filter((n) => normalize(n.name) === normalize(reference))
  if (matches.length === 1) return { ok: true, value: matches[0] }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `Two or more agents are named "${reference.trim()}". Use an id instead: ${matches.map((m) => m.id).join(', ')}.`
    }
  }
  const names = graph.nodes.map((n) => n.name).join(', ')
  return {
    ok: false,
    error: `No agent matches "${reference.trim()}". Agents in this graph: ${names || 'none'}.`
  }
}

/** Accepts an edge id or a `Source->Target` pair. */
export function resolveEdge(graph: Graph, reference: string): Lookup<GraphEdge> {
  const trimmed = reference.trim()
  const byId = graph.edges.find((e) => e.id === trimmed)
  if (byId) return { ok: true, value: byId }
  const arrow = trimmed.split('->')
  if (arrow.length === 2) {
    const from = resolveAgent(graph, arrow[0])
    if (!from.ok) return from
    const to = resolveAgent(graph, arrow[1])
    if (!to.ok) return to
    const matches = graph.edges.filter((e) => e.source === from.value.id && e.target === to.value.id)
    if (matches.length === 1) return { ok: true, value: matches[0] }
    if (matches.length > 1) {
      return {
        ok: false,
        error: `"${from.value.name}" and "${to.value.name}" are joined by more than one edge. Use an id instead: ${matches
          .map((m) => m.id)
          .join(', ')}.`
      }
    }
    return { ok: false, error: `No edge joins "${from.value.name}" to "${to.value.name}".` }
  }
  return { ok: false, error: `No edge matches "${trimmed}". Use an edge id or "Source->Target".` }
}

function withNodes(graph: Graph, nodes: AgentNode[]): Graph {
  return { ...graph, nodes }
}

export function addAgent(graph: Graph, spec: AgentSpec): OpsResult<AgentNode> {
  const name = spec.name.trim()
  if (!name) return { ok: false, error: 'An agent needs a name.' }
  const provider = spec.provider ?? 'anthropic'
  const node = createAgentNode(spec.position ?? nextPosition(graph), {
    name,
    provider,
    model: spec.model?.trim() || DEFAULT_MODELS[provider],
    instructions: spec.instructions ?? '',
    tools: spec.tools ?? []
  })
  if (spec.temperature !== undefined) node.temperature = spec.temperature
  if (spec.maxTokens !== undefined) node.maxTokens = spec.maxTokens
  if (spec.maxTurns !== undefined) node.maxTurns = spec.maxTurns
  const nodes = [...graph.nodes, node]
  const entryNodeId = spec.entry || graph.entryNodeId === null ? node.id : graph.entryNodeId
  return { ok: true, graph: { ...graph, nodes, entryNodeId }, value: node }
}

export function updateAgent(graph: Graph, reference: string, patch: AgentPatch): OpsResult<AgentNode> {
  const found = resolveAgent(graph, reference)
  if (!found.ok) return found
  if (patch.name !== undefined && !patch.name.trim()) return { ok: false, error: 'An agent needs a name.' }
  const updated: AgentNode = { ...found.value }
  if (patch.name !== undefined) updated.name = patch.name.trim()
  if (patch.provider !== undefined) updated.provider = patch.provider
  if (patch.model !== undefined) updated.model = patch.model.trim()
  if (patch.instructions !== undefined) updated.instructions = patch.instructions
  if (patch.tools !== undefined) updated.tools = patch.tools
  if (patch.position !== undefined) updated.position = patch.position
  if (patch.temperature !== undefined) updated.temperature = patch.temperature
  if (patch.maxTokens !== undefined) updated.maxTokens = patch.maxTokens
  if (patch.maxTurns !== undefined) updated.maxTurns = patch.maxTurns
  const nodes = graph.nodes.map((n) => (n.id === updated.id ? updated : n))
  return { ok: true, graph: withNodes(graph, nodes), value: updated }
}

export function removeAgent(graph: Graph, reference: string): OpsResult<{ removedAgentId: string; removedEdgeIds: string[] }> {
  const found = resolveAgent(graph, reference)
  if (!found.ok) return found
  const id = found.value.id
  const removedEdgeIds = graph.edges.filter((e) => e.source === id || e.target === id).map((e) => e.id)
  const next: Graph = {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== id),
    edges: graph.edges.filter((e) => !removedEdgeIds.includes(e.id)),
    entryNodeId: graph.entryNodeId === id ? null : graph.entryNodeId
  }
  return { ok: true, graph: next, value: { removedAgentId: id, removedEdgeIds } }
}

export function setEntry(graph: Graph, reference: string): OpsResult<AgentNode> {
  const found = resolveAgent(graph, reference)
  if (!found.ok) return found
  return { ok: true, graph: { ...graph, entryNodeId: found.value.id }, value: found.value }
}

export function setGraphName(graph: Graph, name: string): OpsResult<string> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: 'A graph needs a name.' }
  return { ok: true, graph: { ...graph, name: trimmed }, value: trimmed }
}

export function connect(
  graph: Graph,
  from: string,
  to: string,
  kind: EdgeKind,
  description?: string
): OpsResult<GraphEdge> {
  const source = resolveAgent(graph, from)
  if (!source.ok) return source
  const target = resolveAgent(graph, to)
  if (!target.ok) return target
  const duplicate = graph.edges.some((e) => e.source === source.value.id && e.target === target.value.id && e.kind === kind)
  if (duplicate) {
    return { ok: false, error: `A ${kind} edge from "${source.value.name}" to "${target.value.name}" already exists.` }
  }
  const edge: GraphEdge = { id: newId(), source: source.value.id, target: target.value.id, kind }
  if (description?.trim()) edge.description = description.trim()
  return { ok: true, graph: { ...graph, edges: [...graph.edges, edge] }, value: edge }
}

export function updateEdgeOp(
  graph: Graph,
  reference: string,
  patch: { kind?: EdgeKind; description?: string }
): OpsResult<GraphEdge> {
  const found = resolveEdge(graph, reference)
  if (!found.ok) return found
  const updated: GraphEdge = { ...found.value }
  if (patch.kind !== undefined) updated.kind = patch.kind
  if (patch.description !== undefined) {
    const trimmed = patch.description.trim()
    if (trimmed) updated.description = trimmed
    else delete updated.description
  }
  const clash = graph.edges.some(
    (e) => e.id !== updated.id && e.source === updated.source && e.target === updated.target && e.kind === updated.kind
  )
  if (clash) return { ok: false, error: `A ${updated.kind} edge already joins those two agents.` }
  return { ok: true, graph: { ...graph, edges: graph.edges.map((e) => (e.id === updated.id ? updated : e)) }, value: updated }
}

export function disconnect(graph: Graph, reference: string): OpsResult<{ removedEdgeId: string }> {
  const found = resolveEdge(graph, reference)
  if (!found.ok) return found
  return {
    ok: true,
    graph: { ...graph, edges: graph.edges.filter((e) => e.id !== found.value.id) },
    value: { removedEdgeId: found.value.id }
  }
}

/** Cheap invariant check used as a guard before a mutation is published. */
export function structuralProblem(graph: Graph): string | null {
  const ids = new Set<string>()
  for (const node of graph.nodes) {
    if (ids.has(node.id)) return `Two agents share the id "${node.id}".`
    ids.add(node.id)
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return `Edge "${edge.id}" points at an agent that does not exist.`
  }
  if (graph.entryNodeId !== null && !ids.has(graph.entryNodeId)) return 'The entry agent does not exist.'
  return null
}
