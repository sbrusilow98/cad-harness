import { describe, it, expect } from 'vitest'
import { validateGraph, hasErrors } from './validate'
import { emptyGraph, createAgentNode } from '@shared/graph-defaults'
import type { Graph } from '@shared/types'

function twoNodeGraph(): Graph {
  const g = emptyGraph()
  const a = createAgentNode({ x: 0, y: 0 }, { id: 'a', name: 'A' })
  const b = createAgentNode({ x: 0, y: 0 }, { id: 'b', name: 'B' })
  g.nodes.push(a, b)
  g.edges.push({ id: 'e1', source: 'a', target: 'b', kind: 'handoff' })
  g.entryNodeId = 'a'
  return g
}

describe('validateGraph', () => {
  it('accepts a valid graph', () => {
    const issues = validateGraph(twoNodeGraph())
    expect(issues).toEqual([])
    expect(hasErrors(issues)).toBe(false)
  })

  it('requires an entry node', () => {
    const g = twoNodeGraph()
    g.entryNodeId = null
    const issues = validateGraph(g)
    expect(issues.some((i) => i.level === 'error' && /entry/i.test(i.message))).toBe(true)
    expect(hasErrors(issues)).toBe(true)
  })

  it('flags an entry that points at a missing node', () => {
    const g = twoNodeGraph()
    g.entryNodeId = 'zzz'
    expect(hasErrors(validateGraph(g))).toBe(true)
  })

  it('flags edges that reference missing nodes', () => {
    const g = twoNodeGraph()
    g.edges.push({ id: 'e2', source: 'a', target: 'missing', kind: 'delegate' })
    const issues = validateGraph(g)
    expect(issues.find((i) => i.edgeId === 'e2')?.level).toBe('error')
  })

  it('flags duplicate edges of the same kind between the same nodes', () => {
    const g = twoNodeGraph()
    g.edges.push({ id: 'e2', source: 'a', target: 'b', kind: 'handoff' })
    expect(validateGraph(g).find((i) => i.edgeId === 'e2')?.level).toBe('error')
  })

  it('allows a handoff and a delegate edge between the same nodes', () => {
    const g = twoNodeGraph()
    g.edges.push({ id: 'e2', source: 'a', target: 'b', kind: 'delegate' })
    expect(hasErrors(validateGraph(g))).toBe(false)
  })

  it('flags empty names and models', () => {
    const g = twoNodeGraph()
    g.nodes[1].name = '  '
    g.nodes[1].model = ''
    const issues = validateGraph(g).filter((i) => i.nodeId === 'b')
    expect(issues).toHaveLength(2)
    expect(issues.every((i) => i.level === 'error')).toBe(true)
  })

  it('warns about unreachable nodes', () => {
    const g = twoNodeGraph()
    g.nodes.push(createAgentNode({ x: 0, y: 0 }, { id: 'c', name: 'C' }))
    const issues = validateGraph(g)
    expect(issues).toEqual([{ level: 'warning', message: '"C" is not reachable from the entry node.', nodeId: 'c' }])
  })

  it('warns about unknown MCP servers when a server list is given', () => {
    const g = twoNodeGraph()
    g.nodes[0].tools = [{ serverId: 'gone', names: '*' }]
    const issues = validateGraph(g, new Set(['other']))
    expect(issues.find((i) => i.nodeId === 'a')?.level).toBe('warning')
    expect(validateGraph(g)).toEqual([])
  })
})
