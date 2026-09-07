import { describe, it, expect, vi } from 'vitest'
import { DocumentService, type OpenDocument } from './document-service'
import { emptyGraph, createAgentNode } from '@shared/graph-defaults'
import { addAgent, setGraphName } from '@shared/graph-ops'
import type { Graph } from '@shared/types'

function graphWithOne(): Graph {
  const g = emptyGraph('Demo')
  g.nodes.push(createAgentNode({ x: 0, y: 0 }, { id: 'a', name: 'A' }))
  g.entryNodeId = 'a'
  return g
}

function make(): { service: DocumentService; pushed: OpenDocument[] } {
  const pushed: OpenDocument[] = []
  return { service: new DocumentService((doc) => pushed.push(doc)), pushed }
}

describe('DocumentService', () => {
  it('starts with an empty untitled document', () => {
    const { service } = make()
    expect(service.get()).toEqual({ graph: emptyGraph(), path: null, dirty: false, revision: 0 })
  })

  it('takes the renderer as the source of truth without pushing back', () => {
    const { service, pushed } = make()
    service.syncFromRenderer({ graph: graphWithOne(), path: '/tmp/a.json', dirty: true })
    expect(service.get()).toMatchObject({ path: '/tmp/a.json', dirty: true, revision: 1 })
    expect(service.get().graph.nodes).toHaveLength(1)
    expect(pushed).toEqual([])
  })

  it('applies a mutation, marks the document dirty, and pushes it', () => {
    const { service, pushed } = make()
    const result = service.mutate((graph) => addAgent(graph, { name: 'Router' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.name).toBe('Router')
    expect(service.get().dirty).toBe(true)
    expect(service.get().revision).toBe(1)
    expect(pushed).toHaveLength(1)
    expect(pushed[0].graph.nodes).toHaveLength(1)
  })

  it('leaves the document untouched when the operation fails', () => {
    const { service, pushed } = make()
    const before = service.get()
    const result = service.mutate((graph) => setGraphName(graph, '   '))
    expect(result).toEqual({ ok: false, error: 'A graph needs a name.' })
    expect(service.get()).toEqual(before)
    expect(pushed).toEqual([])
  })

  it('refuses a mutation that would break the graph', () => {
    const { service, pushed } = make()
    const result = service.mutate((graph) => ({
      ok: true,
      graph: { ...graph, edges: [{ id: 'e1', source: 'ghost', target: 'ghost', kind: 'handoff' as const }] },
      value: 'x'
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/does not exist/)
    expect(pushed).toEqual([])
  })

  it('replaces the document for a new or opened file and pushes it', () => {
    const { service, pushed } = make()
    const replaced = service.replace(graphWithOne(), '/tmp/b.json', false)
    expect(replaced).toMatchObject({ path: '/tmp/b.json', dirty: false, revision: 1 })
    expect(pushed).toHaveLength(1)
    expect(pushed[0].path).toBe('/tmp/b.json')
  })

  it('survives a push target that throws', () => {
    const service = new DocumentService(() => {
      throw new Error('no window')
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(service.mutate((graph) => addAgent(graph, { name: 'Router' })).ok).toBe(true)
    expect(service.get().graph.nodes).toHaveLength(1)
    spy.mockRestore()
  })
})
