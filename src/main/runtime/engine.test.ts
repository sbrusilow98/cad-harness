import { describe, it, expect } from 'vitest'
import { runGraph, type EngineDeps } from './engine'
import type { AssistantPart, ChatProvider, ChatRequest } from '../providers/types'
import type { RunEvent } from '@shared/events'
import { DEFAULT_LIMITS, type Graph, type RunLimits } from '@shared/types'
import { emptyGraph, createAgentNode } from '@shared/graph-defaults'
import type { McpToolInfo } from './graph-tools'

type Script = Array<AssistantPart[] | ((req: ChatRequest) => AssistantPart[])>

function fakeProvider(script: Script): ChatProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  return {
    id: 'anthropic',
    requests,
    async listModels() {
      return []
    },
    async chat(req, onTextDelta) {
      requests.push(req)
      const next = script.shift()
      if (!next) throw new Error('script exhausted')
      const parts = typeof next === 'function' ? next(req) : next
      for (const p of parts) if (p.type === 'text') onTextDelta(p.text)
      return { parts, stopReason: parts.some((p) => p.type === 'tool_call') ? 'tool_use' : 'end' }
    }
  }
}

function text(t: string): AssistantPart[] {
  return [{ type: 'text', text: t }]
}

function call(name: string, args: Record<string, unknown>, id = 'c1'): AssistantPart[] {
  return [{ type: 'tool_call', id, name, args }]
}

interface Harness {
  events: RunEvent[]
  deps: EngineDeps
  provider: ReturnType<typeof fakeProvider>
}

function harness(
  script: Script,
  opts: { limits?: Partial<RunLimits>; tools?: McpToolInfo[]; apiKey?: string | null; callTool?: EngineDeps['callMcpTool'] } = {}
): Harness {
  const events: RunEvent[] = []
  const provider = fakeProvider(script)
  const deps: EngineDeps = {
    getProvider: () => provider,
    getApiKey: async () => (opts.apiKey === undefined ? 'key' : opts.apiKey),
    listMcpTools: async () => ({ tools: opts.tools ?? [], warnings: [] }),
    callMcpTool: opts.callTool ?? (async () => ({ content: 'unused', isError: false })),
    limits: { ...DEFAULT_LIMITS, ...opts.limits },
    emit: (e) => events.push(e)
  }
  return { events, deps, provider }
}

function graph(edges: Graph['edges'], nodeIds = ['a', 'b', 'c']): Graph {
  const g = emptyGraph()
  for (const id of nodeIds) g.nodes.push(createAgentNode({ x: 0, y: 0 }, { id, name: id.toUpperCase() }))
  g.edges.push(...edges)
  g.entryNodeId = 'a'
  return g
}

function types(events: RunEvent[]): string[] {
  return events.map((e) => e.type)
}

async function run(h: Harness, g: Graph, input = 'hello', signal = new AbortController().signal) {
  await runGraph({ runId: 'r1', graph: g, input, signal, deps: h.deps })
}

describe('runGraph', () => {
  it('runs a single node and finishes with its text', async () => {
    const h = harness([text('done')])
    await run(h, graph([], ['a']))
    expect(types(h.events)).toEqual(['run.started', 'node.started', 'node.text', 'node.finished', 'run.finished'])
    expect(h.events.at(-1)).toEqual({ type: 'run.finished', runId: 'r1', output: 'done' })
    expect(h.provider.requests[0].messages).toEqual([{ role: 'user', content: 'hello' }])
    expect(h.provider.requests[0].system).toBe('')
  })

  it('reports validation errors without starting', async () => {
    const h = harness([])
    const g = graph([], ['a'])
    g.entryNodeId = null
    await run(h, g)
    expect(types(h.events)).toEqual(['run.started', 'run.error'])
  })

  it('hands off automatically along a single handoff edge', async () => {
    const h = harness([text('from A'), text('from B')])
    await run(h, graph([{ id: 'e1', source: 'a', target: 'b', kind: 'handoff' }], ['a', 'b']))
    expect(types(h.events)).toEqual([
      'run.started',
      'node.started',
      'node.text',
      'node.finished',
      'edge.traversed',
      'node.started',
      'node.text',
      'node.finished',
      'run.finished'
    ])
    const bStart = h.events.find((e) => e.type === 'node.started' && e.nodeId === 'b')
    expect(bStart).toMatchObject({ input: 'from A', depth: 0, parentExecutionId: null })
    expect(h.events.find((e) => e.type === 'edge.traversed')).toMatchObject({ edgeId: 'e1', kind: 'handoff', message: 'from A' })
    expect(h.events.at(-1)).toMatchObject({ output: 'from B' })
  })

  it('routes with the handoff tool when there are several handoff edges', async () => {
    const h = harness([call('handoff', { target: 'C', message: 'go C' }), text('C done')])
    await run(
      h,
      graph([
        { id: 'e1', source: 'a', target: 'b', kind: 'handoff' },
        { id: 'e2', source: 'a', target: 'c', kind: 'handoff' }
      ])
    )
    const toolNames = h.provider.requests[0].tools.map((t) => t.name)
    expect(toolNames).toEqual(['handoff'])
    expect(h.events.some((e) => e.type === 'node.started' && e.nodeId === 'b')).toBe(false)
    expect(h.events.find((e) => e.type === 'node.started' && e.nodeId === 'c')).toMatchObject({ input: 'go C' })
    expect(h.events.find((e) => e.type === 'edge.traversed')).toMatchObject({ edgeId: 'e2', message: 'go C' })
    expect(h.events.at(-1)).toMatchObject({ type: 'run.finished', output: 'C done' })
  })

  it('returns an error result for an unknown handoff target and keeps going', async () => {
    const h = harness([call('handoff', { target: 'Nope', message: 'x' }), text('recovered')])
    await run(
      h,
      graph([
        { id: 'e1', source: 'a', target: 'b', kind: 'handoff' },
        { id: 'e2', source: 'a', target: 'c', kind: 'handoff' }
      ])
    )
    const result = h.events.find((e) => e.type === 'node.tool.result')
    expect(result).toMatchObject({ isError: true })
    expect(h.provider.requests[1].messages.at(-1)).toMatchObject({ role: 'tool' })
    expect(h.events.at(-1)).toMatchObject({ type: 'run.finished', output: 'recovered' })
  })

  it('delegates to a child and feeds its result back as a tool result', async () => {
    const h = harness([call('delegate_to_b', { task: 'do it' }), text('B result'), text('final')])
    await run(h, graph([{ id: 'e1', source: 'a', target: 'b', kind: 'delegate' }], ['a', 'b']))
    expect(h.provider.requests[0].tools.map((t) => t.name)).toEqual(['delegate_to_b'])
    const bStart = h.events.find((e) => e.type === 'node.started' && e.nodeId === 'b')
    const aStart = h.events.find((e) => e.type === 'node.started' && e.nodeId === 'a')
    expect(bStart).toMatchObject({ input: 'do it', depth: 1, parentExecutionId: (aStart as { executionId: string }).executionId })
    expect(h.events.find((e) => e.type === 'edge.traversed')).toMatchObject({ kind: 'delegate', edgeId: 'e1', message: 'do it' })
    expect(h.events.find((e) => e.type === 'node.tool.result')).toMatchObject({ content: 'B result', isError: false })
    expect(h.provider.requests[2].messages.at(-1)).toEqual({ role: 'tool', results: [{ callId: 'c1', content: 'B result', isError: false }] })
    expect(h.events.at(-1)).toMatchObject({ type: 'run.finished', output: 'final' })
  })

  it('lets a delegated sub-run follow its own handoffs before returning', async () => {
    const h = harness([call('delegate_to_b', { task: 't' }), text('b'), text('c'), text('done')])
    await run(
      h,
      graph([
        { id: 'e1', source: 'a', target: 'b', kind: 'delegate' },
        { id: 'e2', source: 'b', target: 'c', kind: 'handoff' }
      ])
    )
    expect(h.events.find((e) => e.type === 'node.tool.result')).toMatchObject({ content: 'c' })
    expect(h.events.at(-1)).toMatchObject({ type: 'run.finished', output: 'done' })
  })

  it('stops a cyclic graph at the total step limit', async () => {
    const script: Script = []
    for (let i = 0; i < 10; i++) script.push(text(`step ${i}`))
    const h = harness(script, { limits: { maxTotalSteps: 3 } })
    await run(h, graph([{ id: 'e1', source: 'a', target: 'a', kind: 'handoff' }], ['a']))
    expect(h.events.at(-1)).toMatchObject({ type: 'run.error' })
    expect((h.events.at(-1) as { error: string }).error).toMatch(/step limit/)
    expect(h.provider.requests).toHaveLength(3)
  })

  it('stops at the per-node turn limit', async () => {
    const tools: McpToolInfo[] = [{ serverId: 's', serverName: 'S', name: 'ping', description: 'p', inputSchema: { type: 'object' } }]
    const script: Script = []
    for (let i = 0; i < 10; i++) script.push(call('S__ping', {}, `c${i}`))
    const h = harness(script, { limits: { maxTurns: 2 }, tools, callTool: async () => ({ content: 'pong', isError: false }) })
    const g = graph([], ['a'])
    g.nodes[0].tools = [{ serverId: 's', names: '*' }]
    await run(h, g)
    expect(h.provider.requests).toHaveLength(2)
    expect((h.events.at(-1) as { error: string }).error).toMatch(/turn limit/)
    expect(h.events.some((e) => e.type === 'node.error')).toBe(true)
  })

  it('stops at the delegation depth limit', async () => {
    const script: Script = []
    for (let i = 0; i < 10; i++) script.push(call('delegate_to_a', { task: 'again' }, `c${i}`))
    const h = harness(script, { limits: { maxDelegationDepth: 2 } })
    await run(h, graph([{ id: 'e1', source: 'a', target: 'a', kind: 'delegate' }], ['a']))
    expect((h.events.at(-1) as { error: string }).error).toMatch(/depth/)
  })

  it('calls MCP tools and passes tool errors back to the model', async () => {
    const tools: McpToolInfo[] = [{ serverId: 's', serverName: 'S', name: 'read', description: 'r', inputSchema: { type: 'object' } }]
    const calls: unknown[] = []
    const h = harness([call('S__read', { path: '/x' }), text('ok')], {
      tools,
      callTool: async (ref, args) => {
        calls.push([ref, args])
        throw new Error('boom')
      }
    })
    const g = graph([], ['a'])
    g.nodes[0].tools = [{ serverId: 's', names: ['read'] }]
    await run(h, g)
    expect(calls).toEqual([[{ serverId: 's', toolName: 'read' }, { path: '/x' }]])
    expect(h.events.find((e) => e.type === 'node.tool.result')).toMatchObject({ isError: true, content: 'Tool error: boom' })
    expect(h.events.at(-1)).toMatchObject({ type: 'run.finished', output: 'ok' })
  })

  it('fails the run when the provider has no API key', async () => {
    const h = harness([text('never')], { apiKey: null })
    await run(h, graph([], ['a']))
    expect(types(h.events)).toEqual(['run.started', 'node.started', 'node.error', 'run.error'])
    expect((h.events.at(-1) as { error: string }).error).toMatch(/API key/)
  })

  it('reports provider errors', async () => {
    const h = harness([
      () => {
        throw new Error('401 invalid key')
      }
    ])
    await run(h, graph([], ['a']))
    expect(h.events.at(-1)).toEqual({ type: 'run.error', runId: 'r1', error: '401 invalid key' })
  })

  it('cancels when the signal aborts during a provider call', async () => {
    const controller = new AbortController()
    const provider: ChatProvider = {
      id: 'anthropic',
      async listModels() {
        return []
      },
      chat(req) {
        return new Promise((_, reject) => {
          req.signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      }
    }
    const events: RunEvent[] = []
    const deps: EngineDeps = {
      getProvider: () => provider,
      getApiKey: async () => 'k',
      listMcpTools: async () => ({ tools: [], warnings: [] }),
      callMcpTool: async () => ({ content: '', isError: false }),
      limits: DEFAULT_LIMITS,
      emit: (e) => events.push(e)
    }
    const p = runGraph({ runId: 'r1', graph: graph([], ['a']), input: 'x', signal: controller.signal, deps })
    await new Promise((r) => setTimeout(r, 0))
    controller.abort()
    await p
    expect(types(events)).toEqual(['run.started', 'node.started', 'run.cancelled'])
  })

  it('surfaces MCP warnings and passes node settings to the provider', async () => {
    const h = harness([text('x')])
    h.deps.listMcpTools = async () => ({ tools: [], warnings: ['server gone'] })
    const g = graph([], ['a'])
    g.nodes[0].instructions = 'be brief'
    g.nodes[0].model = 'claude-opus-4-6'
    g.nodes[0].temperature = 0.2
    g.nodes[0].maxTokens = 500
    await run(h, g)
    expect(h.events[2]).toEqual({ type: 'run.warning', runId: 'r1', message: 'server gone' })
    expect(h.provider.requests[0]).toMatchObject({
      system: 'be brief',
      temperature: 0.2,
      maxTokens: 500,
      model: 'claude-opus-4-6',
      apiKey: 'key'
    })
  })
})

describe('runGraph MCP listing cache', () => {
  it('lists MCP tools once per run and emits each warning once', async () => {
    const script: Script = []
    for (let i = 0; i < 10; i++) script.push(text(`step ${i}`))
    const h = harness(script, { limits: { maxTotalSteps: 3 } })
    let listCalls = 0
    h.deps.listMcpTools = async () => {
      listCalls++
      return { tools: [], warnings: ['server gone'] }
    }
    const g = graph([{ id: 'e1', source: 'a', target: 'a', kind: 'handoff' }], ['a'])
    g.nodes[0].tools = [{ serverId: 's', names: '*' }]
    await run(h, g)
    expect(listCalls).toBe(1)
    expect(h.events.filter((e) => e.type === 'run.warning')).toHaveLength(1)
  })
})

describe('runGraph limits and empty messages', () => {
  it('clamps a per-node maxTurns of 0 to one turn', async () => {
    const h = harness([text('done')])
    const g = graph([], ['a'])
    g.nodes[0].maxTurns = 0
    await run(h, g)
    expect(h.provider.requests).toHaveLength(1)
    expect(h.events.at(-1)).toMatchObject({ type: 'run.finished', output: 'done' })
  })

  it('drops a non-positive maxTokens instead of sending it to the provider', async () => {
    const h = harness([text('done')])
    const g = graph([], ['a'])
    g.nodes[0].maxTokens = 0
    await run(h, g)
    expect(h.provider.requests[0].maxTokens).toBeUndefined()
  })

  it('drops an out-of-range temperature instead of sending it to the provider', async () => {
    const h = harness([text('done')])
    const g = graph([], ['a'])
    g.nodes[0].temperature = 9
    await run(h, g)
    expect(h.provider.requests[0].temperature).toBeUndefined()
  })

  it('passes an in-range temperature through to the provider', async () => {
    const h = harness([text('done')])
    const g = graph([], ['a'])
    g.nodes[0].model = 'claude-opus-4-6'
    g.nodes[0].temperature = 0.5
    await run(h, g)
    expect(h.provider.requests[0].temperature).toBe(0.5)
  })

  it('drops the temperature and warns for a model that rejects it', async () => {
    const h = harness([text('a'), text('b')])
    const g = graph([{ id: 'e1', source: 'a', target: 'b', kind: 'handoff' }], ['a', 'b'])
    for (const node of g.nodes) {
      node.model = 'claude-opus-5'
      node.temperature = 0.5
    }
    await run(h, g)
    expect(h.provider.requests[0].temperature).toBeUndefined()
    expect(h.provider.requests[1].temperature).toBeUndefined()
    const warnings = h.events.filter((e) => e.type === 'run.warning') as { message: string }[]
    expect(warnings.map((w) => w.message)).toEqual([
      '"claude-opus-5" does not accept a temperature, so the one set on "A" was ignored.',
      '"claude-opus-5" does not accept a temperature, so the one set on "B" was ignored.'
    ])
    expect(h.events.at(-1)).toMatchObject({ type: 'run.finished' })
  })

  it('warns only once when the same agent runs repeatedly', async () => {
    const h = harness([text('1'), text('2'), text('3')])
    const g = graph([{ id: 'e1', source: 'a', target: 'a', kind: 'handoff' }], ['a'])
    g.nodes[0].model = 'claude-opus-5'
    g.nodes[0].temperature = 0.5
    h.deps.limits = { ...h.deps.limits, maxTotalSteps: 3 }
    await run(h, g)
    expect(h.events.filter((e) => e.type === 'run.warning')).toHaveLength(1)
  })

  it('rejects a delegate call with no task instead of running the child', async () => {
    const h = harness([call('delegate_to_b', {}), text('final')])
    await run(h, graph([{ id: 'e1', source: 'a', target: 'b', kind: 'delegate' }], ['a', 'b']))
    expect(h.events.find((e) => e.type === 'node.tool.result')).toMatchObject({ isError: true })
    expect((h.events.find((e) => e.type === 'node.tool.result') as { content: string }).content).toMatch(/task/)
    expect(h.events.some((e) => e.type === 'node.started' && e.nodeId === 'b')).toBe(false)
    expect(h.events.at(-1)).toMatchObject({ type: 'run.finished', output: 'final' })
  })

  it('substitutes a placeholder for an empty auto-handoff message', async () => {
    const h = harness([text(''), text('from B')])
    await run(h, graph([{ id: 'e1', source: 'a', target: 'b', kind: 'handoff' }], ['a', 'b']))
    expect(h.events.find((e) => e.type === 'node.started' && e.nodeId === 'b')).toMatchObject({ input: '(no output)' })
  })

  it('falls back to the node text and then a placeholder for an empty handoff tool message', async () => {
    const h = harness([call('handoff', { target: 'B', message: '' }), text('B done')])
    await run(
      h,
      graph([
        { id: 'e1', source: 'a', target: 'b', kind: 'handoff' },
        { id: 'e2', source: 'a', target: 'c', kind: 'handoff' }
      ])
    )
    expect(h.events.find((e) => e.type === 'node.started' && e.nodeId === 'b')).toMatchObject({ input: '(no output)' })
  })
})

describe('runGraph handoff target matching', () => {
  it('matches a handoff target ignoring surrounding whitespace and case', async () => {
    const h = harness([call('handoff', { target: 'writer ', message: 'go' }), text('written')])
    const g = emptyGraph()
    g.nodes.push(
      createAgentNode({ x: 0, y: 0 }, { id: 'a', name: 'Router' }),
      createAgentNode({ x: 0, y: 0 }, { id: 'b', name: 'Writer' }),
      createAgentNode({ x: 0, y: 0 }, { id: 'c', name: 'Editor' })
    )
    g.edges.push(
      { id: 'e1', source: 'a', target: 'b', kind: 'handoff' },
      { id: 'e2', source: 'a', target: 'c', kind: 'handoff' }
    )
    g.entryNodeId = 'a'
    await run(h, g)
    expect(h.events.find((e) => e.type === 'node.started' && e.nodeId === 'b')).toMatchObject({ input: 'go' })
    expect(h.events.at(-1)).toMatchObject({ type: 'run.finished', output: 'written' })
  })
})
