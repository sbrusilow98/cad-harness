import { describe, it, expect, beforeEach } from 'vitest'
import { emptyGraph } from '@shared/graph-defaults'
import { harness, type Harness } from './test-harness'

describe('document tools', () => {
  let h: Harness

  beforeEach(async () => {
    h = await harness()
  })

  it('lists every document tool', async () => {
    const { tools } = await h.client.listTools()
    const names = tools.map((t) => t.name)
    for (const name of [
      'get_graph',
      'new_graph',
      'open_graph',
      'save_graph',
      'set_graph_name',
      'add_agent',
      'update_agent',
      'remove_agent',
      'set_entry',
      'connect',
      'update_edge',
      'disconnect',
      'validate_graph'
    ]) {
      expect(names).toContain(name)
    }
  })

  it('describes an empty document', async () => {
    const result = await h.call('get_graph')
    expect(result.isError).toBe(false)
    expect(result.payload).toMatchObject({ name: 'Untitled', path: null, dirty: false, entryAgentId: null, agents: [], edges: [] })
  })

  it('adds agents, makes the first one the entry, and connects them by name', async () => {
    const router = await h.call('add_agent', { name: 'Router', instructions: 'Route it.' })
    expect(router.isError).toBe(false)
    expect(router.payload).toMatchObject({ name: 'Router', provider: 'anthropic', instructions: 'Route it.' })

    await h.call('add_agent', { name: 'Writer', provider: 'openai' })
    const edge = await h.call('connect', { from: 'Router', to: 'Writer', kind: 'handoff', description: 'For prose' })
    expect(edge.isError).toBe(false)
    expect(edge.payload).toMatchObject({ from: 'Router', to: 'Writer', kind: 'handoff', description: 'For prose' })

    const graph = await h.call('get_graph')
    expect(graph.payload.agents).toHaveLength(2)
    expect(graph.payload.entryAgentId).toBe(router.payload.id)
    expect(graph.payload.dirty).toBe(true)
  })

  it('updates an agent, moves the entry, and renames the graph', async () => {
    await h.call('add_agent', { name: 'Router' })
    await h.call('add_agent', { name: 'Writer' })
    const updated = await h.call('update_agent', { agent: 'Writer', model: 'claude-sonnet-5', maxTurns: 4 })
    expect(updated.payload).toMatchObject({ name: 'Writer', model: 'claude-sonnet-5', maxTurns: 4 })
    await h.call('set_entry', { agent: 'Writer' })
    await h.call('set_graph_name', { name: 'Pipeline' })
    const graph = await h.call('get_graph')
    expect(graph.payload.name).toBe('Pipeline')
    expect(graph.payload.entryAgentId).toBe(updated.payload.id)
  })

  it('removes an agent together with its edges, and disconnects an edge on its own', async () => {
    await h.call('add_agent', { name: 'Router' })
    await h.call('add_agent', { name: 'Writer' })
    const edge = await h.call('connect', { from: 'Router', to: 'Writer', kind: 'delegate' })
    const changed = await h.call('update_edge', { edge: edge.payload.id, kind: 'handoff' })
    expect(changed.payload.kind).toBe('handoff')

    const disconnected = await h.call('disconnect', { edge: 'Router->Writer' })
    expect(disconnected.isError).toBe(false)
    expect((await h.call('get_graph')).payload.edges).toEqual([])

    await h.call('connect', { from: 'Router', to: 'Writer', kind: 'handoff' })
    const removed = await h.call('remove_agent', { agent: 'Router' })
    expect(removed.payload.removedEdgeIds).toHaveLength(1)
    const graph = await h.call('get_graph')
    expect(graph.payload.agents).toHaveLength(1)
    expect(graph.payload.entryAgentId).toBeNull()
  })

  it('reports unknown and ambiguous references as tool errors', async () => {
    await h.call('add_agent', { name: 'Router' })
    const missing = await h.call('update_agent', { agent: 'Ghost', model: 'x' })
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain('No agent matches "Ghost"')

    await h.call('add_agent', { name: 'Twin' })
    await h.call('add_agent', { name: 'Twin' })
    const ambiguous = await h.call('set_entry', { agent: 'Twin' })
    expect(ambiguous.isError).toBe(true)
    expect(ambiguous.text).toContain('Use an id instead')
  })

  it('refuses a duplicate edge', async () => {
    await h.call('add_agent', { name: 'Router' })
    await h.call('add_agent', { name: 'Writer' })
    await h.call('connect', { from: 'Router', to: 'Writer', kind: 'handoff' })
    const again = await h.call('connect', { from: 'Router', to: 'Writer', kind: 'handoff' })
    expect(again.isError).toBe(true)
    expect(again.text).toContain('already exists')
  })

  it('opens, saves, and starts a new graph', async () => {
    const stored = emptyGraph('From disk')
    h.files.set('/tmp/stored.json', stored)

    const opened = await h.call('open_graph', { path: '/tmp/stored.json' })
    expect(opened.payload).toMatchObject({ name: 'From disk', path: '/tmp/stored.json', dirty: false })

    await h.call('add_agent', { name: 'Router' })
    const saved = await h.call('save_graph')
    expect(saved.payload).toEqual({ path: '/tmp/stored.json', saved: true })
    expect(h.files.get('/tmp/stored.json')?.nodes).toHaveLength(1)
    expect((await h.call('get_graph')).payload.dirty).toBe(false)

    const fresh = await h.call('new_graph', { name: 'Blank' })
    expect(fresh.payload).toMatchObject({ name: 'Blank', path: null, agents: [] })
    const noPath = await h.call('save_graph')
    expect(noPath.isError).toBe(true)
    expect(noPath.text).toContain('path')
  })

  it('reports a missing file as a tool error', async () => {
    const result = await h.call('open_graph', { path: '/tmp/nope.json' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('no such file')
  })

  it('validates the graph', async () => {
    const empty = await h.call('validate_graph')
    expect(empty.payload.ok).toBe(false)
    expect(JSON.stringify(empty.payload.issues)).toContain('entry')

    await h.call('add_agent', { name: 'Router' })
    const valid = await h.call('validate_graph')
    expect(valid.payload.ok).toBe(true)
  })

  it('serves the document as a resource', async () => {
    await h.call('add_agent', { name: 'Router' })
    const result = await h.client.readResource({ uri: 'agentgraph://document' })
    expect(JSON.parse((result.contents[0] as { text: string }).text).agents).toHaveLength(1)
  })
})
