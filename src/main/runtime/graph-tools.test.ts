import { describe, it, expect } from 'vitest'
import { buildNodeToolSet, HANDOFF_TOOL, type McpToolInfo } from './graph-tools'
import { ToolNameRegistry } from '../mcp/naming'
import { emptyGraph, createAgentNode } from '@shared/graph-defaults'
import type { Graph } from '@shared/types'

function graphWith(edges: Graph['edges']): Graph {
  const g = emptyGraph()
  g.nodes.push(
    createAgentNode({ x: 0, y: 0 }, { id: 'a', name: 'Router' }),
    createAgentNode({ x: 0, y: 0 }, { id: 'b', name: 'Writer' }),
    createAgentNode({ x: 0, y: 0 }, { id: 'c', name: 'Code Reviewer' })
  )
  g.edges.push(...edges)
  g.entryNodeId = 'a'
  return g
}

const available: McpToolInfo[] = [
  { serverId: 's1', serverName: 'FreeCAD', name: 'create_object', description: 'Creates', inputSchema: { type: 'object' } },
  { serverId: 's1', serverName: 'FreeCAD', name: 'delete_object', description: 'Deletes', inputSchema: { type: 'object' } },
  { serverId: 's2', serverName: 'Files', name: 'read', description: '', inputSchema: { type: 'object' } }
]

describe('buildNodeToolSet', () => {
  it('exposes only granted MCP tools with prefixed names', () => {
    const g = graphWith([])
    g.nodes[0].tools = [{ serverId: 's1', names: ['create_object'] }]
    const set = buildNodeToolSet(g, g.nodes[0], available, new ToolNameRegistry())
    expect(set.defs.map((d) => d.name)).toEqual(['FreeCAD__create_object'])
    expect(set.mcp.get('FreeCAD__create_object')).toEqual({ serverId: 's1', toolName: 'create_object' })
    expect(set.autoHandoff).toBeNull()
    expect(set.handoffTargets).toBeNull()
  })

  it('grants every tool of a server with "*" and fills empty descriptions', () => {
    const g = graphWith([])
    g.nodes[0].tools = [{ serverId: 's2', names: '*' }]
    const set = buildNodeToolSet(g, g.nodes[0], available, new ToolNameRegistry())
    expect(set.defs).toHaveLength(1)
    expect(set.defs[0].description).toBe('Tool read from Files')
  })

  it('adds one delegate tool per delegate edge', () => {
    const g = graphWith([
      { id: 'e1', source: 'a', target: 'b', kind: 'delegate', description: 'Ask for prose' },
      { id: 'e2', source: 'a', target: 'c', kind: 'delegate' }
    ])
    const set = buildNodeToolSet(g, g.nodes[0], [], new ToolNameRegistry())
    const names = set.defs.map((d) => d.name)
    expect(names).toEqual(['delegate_to_writer', 'delegate_to_code_reviewer'])
    expect(set.delegates.get('delegate_to_writer')?.id).toBe('e1')
    expect(set.defs[0].description).toBe('Ask for prose')
    expect(set.defs[1].description).toBe('Delegate a task to the "Code Reviewer" agent and get its result back.')
    expect(set.defs[0].inputSchema).toEqual({
      type: 'object',
      properties: { task: { type: 'string', description: 'The task or question to hand to this agent. Include all context it needs.' } },
      required: ['task']
    })
  })

  it('uses automatic handoff for a single handoff edge', () => {
    const g = graphWith([{ id: 'e1', source: 'a', target: 'b', kind: 'handoff' }])
    const set = buildNodeToolSet(g, g.nodes[0], [], new ToolNameRegistry())
    expect(set.autoHandoff?.id).toBe('e1')
    expect(set.defs.some((d) => d.name === HANDOFF_TOOL)).toBe(false)
  })

  it('adds a handoff tool with an enum of targets for two or more handoff edges', () => {
    const g = graphWith([
      { id: 'e1', source: 'a', target: 'b', kind: 'handoff', description: 'For writing tasks' },
      { id: 'e2', source: 'a', target: 'c', kind: 'handoff' }
    ])
    const set = buildNodeToolSet(g, g.nodes[0], [], new ToolNameRegistry())
    const handoff = set.defs.find((d) => d.name === HANDOFF_TOOL)!
    expect(set.autoHandoff).toBeNull()
    expect(set.handoffTargets?.get('Writer')?.id).toBe('e1')
    expect(set.handoffTargets?.get('Code Reviewer')?.id).toBe('e2')
    expect((handoff.inputSchema as { properties: { target: { enum: string[] } } }).properties.target.enum).toEqual([
      'Writer',
      'Code Reviewer'
    ])
    expect(handoff.description).toContain('- Writer: For writing tasks')
    expect(handoff.description).toContain('- Code Reviewer')
  })

  it('ignores edges whose target no longer exists', () => {
    const g = graphWith([{ id: 'e1', source: 'a', target: 'ghost', kind: 'handoff' }])
    const set = buildNodeToolSet(g, g.nodes[0], [], new ToolNameRegistry())
    expect(set.autoHandoff).toBeNull()
  })
})

describe('buildNodeToolSet handoff labels', () => {
  it('trims whitespace from handoff enum labels', () => {
    const g = graphWith([
      { id: 'e1', source: 'a', target: 'b', kind: 'handoff' },
      { id: 'e2', source: 'a', target: 'c', kind: 'handoff' }
    ])
    g.nodes[1].name = '  Writer\n'
    const set = buildNodeToolSet(g, g.nodes[0], [], new ToolNameRegistry())
    expect([...set.handoffTargets!.keys()]).toEqual(['Writer', 'Code Reviewer'])
    const def = set.defs.find((d) => d.name === HANDOFF_TOOL)!
    expect((def.inputSchema['properties'] as { target: { enum: string[] } }).target.enum).toEqual(['Writer', 'Code Reviewer'])
  })

  it('falls back to "Agent" for a blank handoff label', () => {
    const g = graphWith([
      { id: 'e1', source: 'a', target: 'b', kind: 'handoff' },
      { id: 'e2', source: 'a', target: 'c', kind: 'handoff' }
    ])
    g.nodes[1].name = '   '
    const set = buildNodeToolSet(g, g.nodes[0], [], new ToolNameRegistry())
    expect([...set.handoffTargets!.keys()]).toEqual(['Agent', 'Code Reviewer'])
  })
})
