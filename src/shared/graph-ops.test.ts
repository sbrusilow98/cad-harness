import { describe, it, expect } from 'vitest'
import {
  addAgent,
  connect,
  disconnect,
  nextPosition,
  removeAgent,
  resolveAgent,
  resolveEdge,
  setEntry,
  setGraphName,
  structuralProblem,
  updateAgent,
  updateEdgeOp
} from './graph-ops'
import { emptyGraph, createAgentNode } from './graph-defaults'
import type { Graph } from './types'

function graphWith(names: string[]): Graph {
  const g = emptyGraph('Demo')
  for (const [i, name] of names.entries()) {
    g.nodes.push(createAgentNode({ x: i * 10, y: 0 }, { id: `n${i}`, name }))
  }
  g.entryNodeId = g.nodes[0]?.id ?? null
  return g
}

describe('resolveAgent', () => {
  it('resolves by id and by unique name, case-insensitively', () => {
    const g = graphWith(['Router', 'Writer'])
    expect(resolveAgent(g, 'n1')).toEqual({ ok: true, value: g.nodes[1] })
    expect(resolveAgent(g, 'writer')).toEqual({ ok: true, value: g.nodes[1] })
    expect(resolveAgent(g, '  Writer ')).toEqual({ ok: true, value: g.nodes[1] })
  })

  it('reports an unknown agent and lists the names that exist', () => {
    const result = resolveAgent(graphWith(['Router', 'Writer']), 'Ghost')
    expect(result).toEqual({ ok: false, error: 'No agent matches "Ghost". Agents in this graph: Router, Writer.' })
  })

  it('reports an ambiguous name with the candidate ids', () => {
    const g = graphWith(['Writer', 'Writer'])
    expect(resolveAgent(g, 'Writer')).toEqual({
      ok: false,
      error: 'Two or more agents are named "Writer". Use an id instead: n0, n1.'
    })
  })
})

describe('nextPosition', () => {
  it('lays new agents out in rows of four', () => {
    expect(nextPosition(emptyGraph())).toEqual({ x: 80, y: 80 })
    expect(nextPosition(graphWith(['a', 'b', 'c', 'd']))).toEqual({ x: 80, y: 260 })
  })
})

describe('addAgent', () => {
  it('adds an agent with defaults and makes the first one the entry', () => {
    const result = addAgent(emptyGraph(), { name: 'Router' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      name: 'Router',
      provider: 'anthropic',
      model: 'claude-opus-5',
      instructions: '',
      tools: [],
      position: { x: 80, y: 80 }
    })
    expect(result.graph.entryNodeId).toBe(result.value.id)
    expect(result.graph.nodes).toHaveLength(1)
  })

  it('honours an explicit provider, model, position and entry flag', () => {
    const g = graphWith(['Router'])
    const result = addAgent(g, { name: 'Writer', provider: 'openai', position: { x: 5, y: 6 }, entry: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ provider: 'openai', model: 'gpt-5', position: { x: 5, y: 6 } })
    expect(result.graph.entryNodeId).toBe(result.value.id)
  })

  it('rejects a blank name', () => {
    expect(addAgent(emptyGraph(), { name: '  ' })).toEqual({ ok: false, error: 'An agent needs a name.' })
  })
})

describe('updateAgent', () => {
  it('applies a patch and leaves other fields alone', () => {
    const g = graphWith(['Router'])
    const result = updateAgent(g, 'Router', { instructions: 'Route the work.', maxTurns: 3 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ name: 'Router', instructions: 'Route the work.', maxTurns: 3 })
  })

  it('rejects an unknown agent', () => {
    expect(updateAgent(graphWith(['Router']), 'Ghost', { name: 'x' }).ok).toBe(false)
  })

  it('clears an optional field when the patch passes null, and leaves it alone when the key is absent', () => {
    const g = graphWith(['Router'])
    const set = updateAgent(g, 'Router', { temperature: 0.5, maxTokens: 100, maxTurns: 3 })
    expect(set.ok).toBe(true)
    if (!set.ok) return
    expect(set.value).toMatchObject({ temperature: 0.5, maxTokens: 100, maxTurns: 3 })

    const untouched = updateAgent(set.graph, 'Router', { instructions: 'x' })
    expect(untouched.ok).toBe(true)
    if (!untouched.ok) return
    expect(untouched.value.temperature).toBe(0.5)

    const cleared = updateAgent(set.graph, 'Router', { temperature: null, maxTokens: null, maxTurns: null })
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect('temperature' in cleared.value).toBe(false)
    expect('maxTokens' in cleared.value).toBe(false)
    expect('maxTurns' in cleared.value).toBe(false)
  })
})

describe('removeAgent', () => {
  it('removes the agent, its edges, and clears the entry when it was the entry', () => {
    const g = graphWith(['Router', 'Writer'])
    const connected = connect(g, 'Router', 'Writer', 'handoff')
    expect(connected.ok).toBe(true)
    if (!connected.ok) return
    const result = removeAgent(connected.graph, 'Router')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.nodes.map((n) => n.name)).toEqual(['Writer'])
    expect(result.graph.edges).toEqual([])
    expect(result.graph.entryNodeId).toBeNull()
    expect(result.value).toEqual({ removedAgentId: 'n0', removedEdgeIds: [connected.value.id] })
  })
})

describe('connect', () => {
  it('creates an edge with a description', () => {
    const result = connect(graphWith(['Router', 'Writer']), 'Router', 'Writer', 'delegate', 'Ask for prose')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ source: 'n0', target: 'n1', kind: 'delegate', description: 'Ask for prose' })
  })

  it('rejects a duplicate edge of the same kind', () => {
    const first = connect(graphWith(['Router', 'Writer']), 'Router', 'Writer', 'handoff')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(connect(first.graph, 'Router', 'Writer', 'handoff')).toEqual({
      ok: false,
      error: 'A handoff edge from "Router" to "Writer" already exists.'
    })
    expect(connect(first.graph, 'Router', 'Writer', 'delegate').ok).toBe(true)
  })

  it('rejects an unknown endpoint', () => {
    expect(connect(graphWith(['Router']), 'Router', 'Ghost', 'handoff').ok).toBe(false)
  })
})

describe('updateEdgeOp and disconnect', () => {
  it('changes the kind and description, then removes the edge', () => {
    const made = connect(graphWith(['Router', 'Writer']), 'Router', 'Writer', 'handoff')
    expect(made.ok).toBe(true)
    if (!made.ok) return
    const updated = updateEdgeOp(made.graph, made.value.id, { kind: 'delegate', description: 'why' })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.value).toMatchObject({ kind: 'delegate', description: 'why' })
    const removed = disconnect(updated.graph, made.value.id)
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.graph.edges).toEqual([])
  })

  it('resolves an edge by its endpoints', () => {
    const made = connect(graphWith(['Router', 'Writer']), 'Router', 'Writer', 'handoff')
    expect(made.ok).toBe(true)
    if (!made.ok) return
    expect(resolveEdge(made.graph, 'Router->Writer')).toEqual({ ok: true, value: made.value })
    expect(resolveEdge(made.graph, 'Ghost->Writer').ok).toBe(false)
  })
})

describe('setEntry and setGraphName', () => {
  it('sets the entry agent and renames the graph', () => {
    const g = graphWith(['Router', 'Writer'])
    const entry = setEntry(g, 'Writer')
    expect(entry.ok).toBe(true)
    if (!entry.ok) return
    expect(entry.graph.entryNodeId).toBe('n1')
    const named = setGraphName(entry.graph, ' Pipeline ')
    expect(named.ok).toBe(true)
    if (!named.ok) return
    expect(named.graph.name).toBe('Pipeline')
    expect(setGraphName(g, '   ').ok).toBe(false)
  })
})

describe('structuralProblem', () => {
  it('accepts a sound graph and names a dangling edge or duplicate id', () => {
    const g = graphWith(['Router', 'Writer'])
    expect(structuralProblem(g)).toBeNull()
    const dangling = { ...g, edges: [{ id: 'e1', source: 'n0', target: 'ghost', kind: 'handoff' as const }] }
    expect(structuralProblem(dangling)).toMatch(/edge/i)
    const duplicate = { ...g, nodes: [...g.nodes, g.nodes[0]] }
    expect(structuralProblem(duplicate)).toMatch(/id/i)
  })

  it('names a duplicate edge id', () => {
    const g = graphWith(['Router', 'Writer'])
    const made = connect(g, 'Router', 'Writer', 'handoff')
    expect(made.ok).toBe(true)
    if (!made.ok) return
    const duplicated = { ...made.graph, edges: [made.value, { ...made.value, kind: 'delegate' as const }] }
    expect(structuralProblem(duplicated)).toBe(`Two edges share the id "${made.value.id}".`)
  })
})
