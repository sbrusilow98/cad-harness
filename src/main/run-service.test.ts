import { describe, it, expect, vi } from 'vitest'
import { RunService, MAX_EXECUTION_TEXT, MAX_TOOL_RESULT, type RunServiceDeps } from './run-service'
import type { RunEvent } from '@shared/events'
import { emptyGraph, createAgentNode } from '@shared/graph-defaults'
import type { Graph } from '@shared/types'

function graph(): Graph {
  const g = emptyGraph('Demo')
  g.nodes.push(createAgentNode({ x: 0, y: 0 }, { id: 'a', name: 'A' }))
  g.entryNodeId = 'a'
  return g
}

interface Harness {
  service: RunService
  broadcast: RunEvent[]
  emitters: ((event: RunEvent) => void)[]
  settle: (() => void)[]
  signals: AbortSignal[]
}

/** Drives the service with a fake engine whose completion we control. */
function harness(): Harness {
  const broadcast: RunEvent[] = []
  const emitters: ((event: RunEvent) => void)[] = []
  const settle: (() => void)[] = []
  const signals: AbortSignal[] = []
  const deps: RunServiceDeps = {
    broadcast: (event) => broadcast.push(event),
    startRun: ({ emit, signal }) => {
      emitters.push(emit)
      signals.push(signal)
      return new Promise<void>((resolve) => settle.push(resolve))
    }
  }
  return { service: new RunService(deps), broadcast, emitters, settle, signals }
}

describe('RunService', () => {
  it('records a run, broadcasts its events, and exposes the transcript', async () => {
    const h = harness()
    const runId = h.service.start(graph(), 'do it')
    const emit = h.emitters[0]
    emit({ type: 'run.started', runId })
    emit({ type: 'node.started', runId, executionId: 'x1', nodeId: 'a', parentExecutionId: null, input: 'do it', depth: 0 })
    emit({ type: 'node.text', runId, executionId: 'x1', delta: 'Hello' })
    emit({ type: 'node.finished', runId, executionId: 'x1', output: 'Hello' })
    emit({ type: 'run.finished', runId, output: 'Hello' })
    h.settle[0]()
    await h.service.wait(runId, 1000)

    const record = h.service.get(runId)
    expect(record).toMatchObject({ id: runId, status: 'finished', input: 'do it', output: 'Hello' })
    expect(record?.executions).toHaveLength(1)
    expect(record?.executions[0]).toMatchObject({ nodeId: 'a', text: 'Hello', status: 'done' })
    expect(record?.finishedAt).not.toBeNull()
    expect(h.broadcast.map((e) => e.type)).toEqual(['run.started', 'node.started', 'node.text', 'node.finished', 'run.finished'])
  })

  it('waits for a run and resolves as soon as it finishes', async () => {
    const h = harness()
    const runId = h.service.start(graph(), 'x')
    const pending = h.service.wait(runId, 2000)
    h.emitters[0]({ type: 'run.started', runId })
    h.emitters[0]({ type: 'run.finished', runId, output: 'done' })
    h.settle[0]()
    await expect(pending).resolves.toMatchObject({ status: 'finished', output: 'done' })
  })

  it('resolves a still-running record when the wait times out', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      const runId = h.service.start(graph(), 'x')
      h.emitters[0]({ type: 'run.started', runId })
      const pending = h.service.wait(runId, 50)
      await vi.advanceTimersByTimeAsync(60)
      await expect(pending).resolves.toMatchObject({ status: 'running' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops a run through its abort signal and reports an unknown id', () => {
    const h = harness()
    const runId = h.service.start(graph(), 'x')
    expect(h.service.stop(runId)).toBe(true)
    expect(h.signals[0].aborted).toBe(true)
    expect(h.service.stop('nope')).toBe(false)
  })

  it('marks a run errored when the engine rejects', async () => {
    const broadcast: RunEvent[] = []
    const deps: RunServiceDeps = {
      broadcast: (event) => broadcast.push(event),
      startRun: () => Promise.reject(new Error('engine exploded'))
    }
    const service = new RunService(deps)
    const runId = service.start(graph(), 'x')
    const record = await service.wait(runId, 1000)
    expect(record).toMatchObject({ status: 'error', error: 'engine exploded' })
  })

  it('truncates long streamed text and long tool results', async () => {
    const h = harness()
    const runId = h.service.start(graph(), 'x')
    const emit = h.emitters[0]
    emit({ type: 'run.started', runId })
    emit({ type: 'node.started', runId, executionId: 'x1', nodeId: 'a', parentExecutionId: null, input: '', depth: 0 })
    emit({ type: 'node.text', runId, executionId: 'x1', delta: 'a'.repeat(MAX_EXECUTION_TEXT + 500) })
    emit({ type: 'node.text', runId, executionId: 'x1', delta: 'ignored' })
    emit({ type: 'node.tool.call', runId, executionId: 'x1', callId: 'c1', name: 't', args: {} })
    emit({ type: 'node.tool.result', runId, executionId: 'x1', callId: 'c1', content: 'b'.repeat(MAX_TOOL_RESULT + 500), isError: false })

    const record = h.service.get(runId)!
    const execution = record.executions[0]
    expect(execution.text.length).toBeLessThanOrEqual(MAX_EXECUTION_TEXT + 40)
    expect(execution.text.endsWith('[truncated]')).toBe(true)
    expect(execution.text).not.toContain('ignored')
    expect(execution.toolCalls[0].result?.endsWith('[truncated]')).toBe(true)
  })

  it('keeps only the most recent runs and lists them newest first', () => {
    const h = harness()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push(h.service.start(graph(), `run ${i}`))
    expect(h.service.list().map((r) => r.input)).toEqual(['run 2', 'run 1', 'run 0'])
    expect(h.service.list(2)).toHaveLength(2)
    expect(h.service.get(ids[0])).toBeDefined()
  })
})
