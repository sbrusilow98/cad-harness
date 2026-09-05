import { describe, it, expect } from 'vitest'
import { parseGraphFile, serializeGraph, normalizeGraph } from './graph-files'
import { emptyGraph, createAgentNode } from '@shared/graph-defaults'

describe('graph files', () => {
  it('round-trips a graph', () => {
    const g = emptyGraph('Demo')
    g.nodes.push(createAgentNode({ x: 1, y: 2 }, { id: 'a', name: 'A', tools: [{ serverId: 's', names: ['x'] }], temperature: 0.5 }))
    g.entryNodeId = 'a'
    const text = serializeGraph(g)
    expect(text.endsWith('\n')).toBe(true)
    expect(parseGraphFile(text)).toEqual(g)
  })

  it('rejects invalid JSON and wrong versions', () => {
    expect(() => parseGraphFile('{')).toThrow(/valid JSON/)
    expect(() => parseGraphFile('{"version":2,"nodes":[],"edges":[]}')).toThrow(/version/)
    expect(() => parseGraphFile('[]')).toThrow()
    expect(() => parseGraphFile('{"version":1}')).toThrow(/nodes or edges/)
  })

  it('fills defaults and drops malformed pieces', () => {
    const g = normalizeGraph({
      version: 1,
      name: '',
      entryNodeId: 'missing',
      nodes: [{ id: 'n1', provider: 'martian', tools: [{ serverId: 's', names: '*' }, { bad: true }, { serverId: 's2', names: ['a', 3] }] }],
      edges: [{ id: 'e1', source: 'n1', target: 'n1', kind: 'weird' }, { source: 'x' }]
    })
    expect(g.name).toBe('Untitled')
    expect(g.entryNodeId).toBeNull()
    expect(g.nodes[0]).toEqual({
      id: 'n1',
      name: 'Agent',
      position: { x: 0, y: 0 },
      provider: 'anthropic',
      model: 'claude-opus-5',
      instructions: '',
      tools: [
        { serverId: 's', names: '*' },
        { serverId: 's2', names: ['a'] }
      ]
    })
    expect(g.edges).toEqual([{ id: 'e1', source: 'n1', target: 'n1', kind: 'handoff' }])
  })

  it('requires node ids', () => {
    expect(() => normalizeGraph({ version: 1, nodes: [{ name: 'x' }], edges: [] })).toThrow(/id/)
  })

  it('drops edges that reference missing nodes', () => {
    const g = normalizeGraph({
      version: 1,
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [
        { id: 'e1', source: 'a', target: 'b', kind: 'handoff' },
        { id: 'e2', source: 'a', target: 'ghost', kind: 'handoff' },
        { id: 'e3', source: 'ghost', target: 'b', kind: 'delegate' }
      ]
    })
    expect(g.edges.map((e) => e.id)).toEqual(['e1'])
  })

  it('keeps the first node when ids repeat', () => {
    const g = normalizeGraph({
      version: 1,
      entryNodeId: 'a',
      nodes: [{ id: 'a', name: 'First' }, { id: 'a', name: 'Second' }, { id: 'b' }],
      edges: []
    })
    expect(g.nodes.map((n) => n.name)).toEqual(['First', 'Agent'])
    expect(g.entryNodeId).toBe('a')
  })
})
