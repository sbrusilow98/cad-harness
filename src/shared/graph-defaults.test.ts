import { describe, it, expect } from 'vitest'
import { emptyGraph, createAgentNode } from './graph-defaults'

describe('graph defaults', () => {
  it('creates an empty graph with no entry', () => {
    const g = emptyGraph('Demo')
    expect(g).toEqual({ version: 1, name: 'Demo', entryNodeId: null, nodes: [], edges: [] })
  })

  it('creates an agent node with defaults and a unique id', () => {
    const a = createAgentNode({ x: 10, y: 20 })
    const b = createAgentNode({ x: 0, y: 0 }, { name: 'Writer' })
    expect(a.id).not.toBe(b.id)
    expect(a.position).toEqual({ x: 10, y: 20 })
    expect(a.provider).toBe('anthropic')
    expect(a.model).toBe('claude-opus-5')
    expect(a.instructions).toBe('')
    expect(a.tools).toEqual([])
    expect(b.name).toBe('Writer')
  })
})
