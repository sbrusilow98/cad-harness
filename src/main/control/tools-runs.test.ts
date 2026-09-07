import { describe, it, expect } from 'vitest'
import { harness } from './test-harness'
import { RunService } from '../run-service'
import type { RunEvent } from '@shared/events'

/** A run service whose fake engine finishes immediately with a scripted transcript. */
function scriptedRuns(): RunService {
  return new RunService({
    broadcast: () => undefined,
    startRun: async ({ runId, emit, input }) => {
      emit({ type: 'run.started', runId })
      emit({ type: 'node.started', runId, executionId: 'x1', nodeId: 'a', parentExecutionId: null, input, depth: 0 })
      emit({ type: 'node.text', runId, executionId: 'x1', delta: 'Answer' })
      emit({ type: 'node.finished', runId, executionId: 'x1', output: 'Answer' })
      emit({ type: 'run.finished', runId, output: 'Answer' })
    }
  })
}

function neverEndingRuns(): RunService {
  return new RunService({
    broadcast: () => undefined,
    startRun: ({ runId, emit }) => {
      emit({ type: 'run.started', runId })
      return new Promise<void>(() => undefined)
    }
  })
}

describe('run tools', () => {
  it('refuses to run a graph with no entry agent', async () => {
    const h = await harness({ runs: scriptedRuns() })
    const result = await h.call('run_graph', { input: 'hello' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('entry')
  })

  it('runs the open graph and returns the transcript', async () => {
    const h = await harness({ runs: scriptedRuns() })
    await h.call('add_agent', { name: 'Router' })
    const result = await h.call('run_graph', { input: 'hello' })
    expect(result.isError).toBe(false)
    expect(result.payload).toMatchObject({ status: 'finished', output: 'Answer', input: 'hello' })
    expect(result.payload.executions[0]).toMatchObject({ text: 'Answer', status: 'done' })
    expect(typeof result.payload.runId).toBe('string')
  })

  it('returns immediately when asked not to wait', async () => {
    const h = await harness({ runs: neverEndingRuns() })
    await h.call('add_agent', { name: 'Router' })
    const result = await h.call('run_graph', { input: 'hello', wait: false })
    expect(result.payload).toMatchObject({ status: 'running' })
    expect(result.payload.executions).toBeUndefined()
  })

  it('reports a still-running status when the wait elapses', async () => {
    const h = await harness({ runs: neverEndingRuns() })
    await h.call('add_agent', { name: 'Router' })
    const result = await h.call('run_graph', { input: 'hello', timeoutSeconds: 0.05 })
    expect(result.payload.status).toBe('running')
    expect(result.payload.note).toContain('get_run')
  })

  it('reads a run back, lists runs, and stops one', async () => {
    const h = await harness({ runs: neverEndingRuns() })
    await h.call('add_agent', { name: 'Router' })
    const started = await h.call('run_graph', { input: 'hello', wait: false })
    const runId = started.payload.runId as string

    const fetched = await h.call('get_run', { runId })
    expect(fetched.payload).toMatchObject({ runId, status: 'running' })

    const listed = await h.call('list_runs')
    expect(listed.payload.runs).toHaveLength(1)
    expect(listed.payload.runs[0]).toMatchObject({ runId, input: 'hello' })

    const stopped = await h.call('stop_run', { runId })
    expect(stopped.payload).toMatchObject({ runId, stopped: true })

    const unknown = await h.call('get_run', { runId: 'nope' })
    expect(unknown.isError).toBe(true)
    expect(unknown.text).toContain('nope')
    expect((await h.call('stop_run', { runId: 'nope' })).isError).toBe(true)
  })

  it('serves a run as a resource', async () => {
    const h = await harness({ runs: scriptedRuns() })
    await h.call('add_agent', { name: 'Router' })
    const run = await h.call('run_graph', { input: 'hello' })
    const uri = `agentgraph://runs/${run.payload.runId}`
    const result = await h.client.readResource({ uri })
    expect(JSON.parse((result.contents[0] as { text: string }).text)).toMatchObject({ status: 'finished' })

    await expect(h.client.readResource({ uri: 'agentgraph://runs/nope' })).rejects.toThrow(/nope/)
  })
})
