import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphStore } from './graph'
import { emptyGraph } from '@shared/graph-defaults'

const s = () => useGraphStore.getState()

beforeEach(() => {
  s().newGraph()
})

describe('graph store', () => {
  it('starts clean and empty', () => {
    expect(s().graph).toEqual(emptyGraph())
    expect(s().dirty).toBe(false)
    expect(s().path).toBeNull()
  })

  it('adds nodes and marks the first one as entry', () => {
    const a = s().addNode({ x: 1, y: 2 })
    const b = s().addNode({ x: 3, y: 4 })
    expect(s().graph.nodes.map((n) => n.id)).toEqual([a.id, b.id])
    expect(s().graph.entryNodeId).toBe(a.id)
    expect(s().dirty).toBe(true)
  })

  it('updates and moves nodes', () => {
    const a = s().addNode({ x: 0, y: 0 })
    s().updateNode(a.id, { name: 'Router', model: 'x' })
    s().moveNode(a.id, { x: 9, y: 9 })
    expect(s().graph.nodes[0]).toMatchObject({ name: 'Router', model: 'x', position: { x: 9, y: 9 } })
  })

  it('connects nodes, rejects duplicates, and flips kinds', () => {
    const a = s().addNode({ x: 0, y: 0 })
    const b = s().addNode({ x: 0, y: 0 })
    const e = s().addEdge(a.id, b.id)
    expect(e).toMatchObject({ source: a.id, target: b.id, kind: 'handoff' })
    expect(s().addEdge(a.id, b.id)).toBeNull()
    expect(s().addEdge(a.id, b.id, 'delegate')).not.toBeNull()
    expect(s().addEdge(a.id, 'ghost')).toBeNull()
    s().updateEdge(e!.id, { kind: 'delegate', description: 'd' })
    expect(s().graph.edges[0]).toMatchObject({ kind: 'delegate', description: 'd' })
  })

  it('removes nodes with their edges and clears the entry', () => {
    const a = s().addNode({ x: 0, y: 0 })
    const b = s().addNode({ x: 0, y: 0 })
    s().addEdge(a.id, b.id)
    s().removeNodes([a.id])
    expect(s().graph.nodes.map((n) => n.id)).toEqual([b.id])
    expect(s().graph.edges).toEqual([])
    expect(s().graph.entryNodeId).toBeNull()
  })

  it('removes edges and sets entry', () => {
    const a = s().addNode({ x: 0, y: 0 })
    const b = s().addNode({ x: 0, y: 0 })
    const e = s().addEdge(a.id, b.id)!
    s().removeEdges([e.id])
    expect(s().graph.edges).toEqual([])
    s().setEntry(b.id)
    expect(s().graph.entryNodeId).toBe(b.id)
  })

  it('duplicates a node with an offset and a new id', () => {
    const a = s().addNode({ x: 10, y: 10 })
    s().updateNode(a.id, { name: 'Orig', instructions: 'i' })
    const copy = s().duplicateNode(a.id)!
    expect(copy.id).not.toBe(a.id)
    expect(copy).toMatchObject({ name: 'Orig copy', instructions: 'i', position: { x: 50, y: 50 } })
    expect(s().duplicateNode('ghost')).toBeNull()
  })

  it('tracks path and dirty state through save and load', () => {
    s().addNode({ x: 0, y: 0 })
    s().markSaved('/tmp/a.json')
    expect(s().dirty).toBe(false)
    expect(s().path).toBe('/tmp/a.json')
    s().setName('Renamed')
    expect(s().dirty).toBe(true)
    const g = emptyGraph('Loaded')
    s().setGraph(g, '/tmp/b.json')
    expect(s().graph.name).toBe('Loaded')
    expect(s().path).toBe('/tmp/b.json')
    expect(s().dirty).toBe(false)
  })
})

describe('remote documents', () => {
  it('adopts a document pushed from the main process, keeping its dirty flag', () => {
    const g = emptyGraph('Remote')
    s().applyRemote(g, '/tmp/remote.json', true)
    expect(s().graph.name).toBe('Remote')
    expect(s().path).toBe('/tmp/remote.json')
    expect(s().dirty).toBe(true)
    s().applyRemote(emptyGraph('Saved'), '/tmp/remote.json', false)
    expect(s().dirty).toBe(false)
  })
})
