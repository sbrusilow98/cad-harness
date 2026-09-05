import { create } from 'zustand'
import type { AgentNode, EdgeKind, Graph, GraphEdge, Position } from '@shared/types'
import { createAgentNode, emptyGraph, newId } from '@shared/graph-defaults'

interface GraphState {
  graph: Graph
  path: string | null
  dirty: boolean
  setGraph(graph: Graph, path: string | null): void
  newGraph(): void
  setName(name: string): void
  addNode(position: Position): AgentNode
  updateNode(id: string, patch: Partial<AgentNode>): void
  moveNode(id: string, position: Position): void
  removeNodes(ids: string[]): void
  duplicateNode(id: string): AgentNode | null
  addEdge(source: string, target: string, kind?: EdgeKind): GraphEdge | null
  updateEdge(id: string, patch: Partial<GraphEdge>): void
  removeEdges(ids: string[]): void
  setEntry(id: string): void
  markSaved(path: string): void
}

export const useGraphStore = create<GraphState>((set, get) => {
  const patchGraph = (fn: (graph: Graph) => Graph): void => {
    set((state) => ({ graph: fn(state.graph), dirty: true }))
  }

  return {
    graph: emptyGraph(),
    path: null,
    dirty: false,

    setGraph(graph, path) {
      set({ graph, path, dirty: false })
    },

    newGraph() {
      set({ graph: emptyGraph(), path: null, dirty: false })
    },

    setName(name) {
      patchGraph((g) => ({ ...g, name }))
    },

    addNode(position) {
      const node = createAgentNode(position)
      patchGraph((g) => ({
        ...g,
        nodes: [...g.nodes, node],
        entryNodeId: g.entryNodeId ?? node.id
      }))
      return node
    },

    updateNode(id, patch) {
      patchGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }))
    },

    moveNode(id, position) {
      patchGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, position } : n)) }))
    },

    removeNodes(ids) {
      const gone = new Set(ids)
      patchGraph((g) => ({
        ...g,
        nodes: g.nodes.filter((n) => !gone.has(n.id)),
        edges: g.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
        entryNodeId: g.entryNodeId && gone.has(g.entryNodeId) ? null : g.entryNodeId
      }))
    },

    duplicateNode(id) {
      const source = get().graph.nodes.find((n) => n.id === id)
      if (!source) return null
      const copy: AgentNode = {
        ...source,
        id: newId(),
        name: `${source.name} copy`,
        position: { x: source.position.x + 40, y: source.position.y + 40 },
        tools: source.tools.map((t) => ({ ...t, names: t.names === '*' ? '*' : [...t.names] }))
      }
      patchGraph((g) => ({ ...g, nodes: [...g.nodes, copy] }))
      return copy
    },

    addEdge(source, target, kind = 'handoff') {
      const g = get().graph
      const ids = new Set(g.nodes.map((n) => n.id))
      if (!ids.has(source) || !ids.has(target)) return null
      if (g.edges.some((e) => e.source === source && e.target === target && e.kind === kind)) return null
      const edge: GraphEdge = { id: newId(), source, target, kind }
      patchGraph((graph) => ({ ...graph, edges: [...graph.edges, edge] }))
      return edge
    },

    updateEdge(id, patch) {
      patchGraph((g) => ({ ...g, edges: g.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
    },

    removeEdges(ids) {
      const gone = new Set(ids)
      patchGraph((g) => ({ ...g, edges: g.edges.filter((e) => !gone.has(e.id)) }))
    },

    setEntry(id) {
      patchGraph((g) => ({ ...g, entryNodeId: id }))
    },

    markSaved(path) {
      set({ path, dirty: false })
    }
  }
})
