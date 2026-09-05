import { describe, it, expect } from 'vitest'
import { applyRunEvent, initialRunState, type RunState } from './run'
import type { RunEvent } from '@shared/events'

function play(events: RunEvent[]): RunState {
  return events.reduce(applyRunEvent, initialRunState)
}

describe('applyRunEvent', () => {
  it('builds executions from events', () => {
    const state = play([
      { type: 'run.started', runId: 'r' },
      { type: 'node.started', runId: 'r', executionId: 'x1', nodeId: 'a', parentExecutionId: null, input: 'hi', depth: 0 },
      { type: 'node.text', runId: 'r', executionId: 'x1', delta: 'Hel' },
      { type: 'node.text', runId: 'r', executionId: 'x1', delta: 'lo' },
      { type: 'node.tool.call', runId: 'r', executionId: 'x1', callId: 'c1', name: 'read', args: { p: 1 } },
      { type: 'node.tool.result', runId: 'r', executionId: 'x1', callId: 'c1', content: 'data', isError: false },
      { type: 'edge.traversed', runId: 'r', fromExecutionId: 'x1', edgeId: 'e1', kind: 'handoff', message: 'next' },
      { type: 'node.finished', runId: 'r', executionId: 'x1', output: 'Hello' },
      { type: 'run.finished', runId: 'r', output: 'Hello' }
    ])
    expect(state.status).toBe('finished')
    expect(state.output).toBe('Hello')
    expect(state.executions).toHaveLength(1)
    expect(state.executions[0]).toMatchObject({
      nodeId: 'a',
      text: 'Hello',
      status: 'done',
      output: 'Hello',
      toolCalls: [{ callId: 'c1', name: 'read', args: { p: 1 }, result: 'data', isError: false }],
      markers: [{ kind: 'handoff', edgeId: 'e1', message: 'next' }]
    })
    expect(state.traversedEdgeIds).toEqual(['e1'])
    expect(state.nodeStatus).toEqual({ a: 'done' })
  })

  it('records errors, warnings, and cancellation', () => {
    const errored = play([
      { type: 'run.started', runId: 'r' },
      { type: 'run.warning', runId: 'r', message: 'w' },
      { type: 'node.started', runId: 'r', executionId: 'x1', nodeId: 'a', parentExecutionId: null, input: '', depth: 0 },
      { type: 'node.error', runId: 'r', executionId: 'x1', error: 'bad' },
      { type: 'run.error', runId: 'r', error: 'bad' }
    ])
    expect(errored.status).toBe('error')
    expect(errored.error).toBe('bad')
    expect(errored.warnings).toEqual(['w'])
    expect(errored.executions[0]).toMatchObject({ status: 'error', error: 'bad' })
    expect(errored.nodeStatus).toEqual({ a: 'error' })

    const cancelled = play([{ type: 'run.started', runId: 'r' }, { type: 'run.cancelled', runId: 'r' }])
    expect(cancelled.status).toBe('cancelled')
  })

  it('ignores events from other runs and resets on a new run', () => {
    const state = play([
      { type: 'run.started', runId: 'r1' },
      { type: 'node.started', runId: 'r1', executionId: 'x1', nodeId: 'a', parentExecutionId: null, input: '', depth: 0 },
      { type: 'run.started', runId: 'r2' },
      { type: 'node.text', runId: 'r1', executionId: 'x1', delta: 'stale' }
    ])
    expect(state.runId).toBe('r2')
    expect(state.executions).toEqual([])
    expect(state.status).toBe('running')
  })
})
