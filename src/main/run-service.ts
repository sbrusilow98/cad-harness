import type { RunEvent } from '@shared/events'
import type { Graph } from '@shared/types'
import { applyRunEvent, initialRunState, type ExecutionView, type RunState } from '@shared/run-transcript'
import { errorMessage } from '@shared/errors'

export const MAX_RUNS = 50
export const MAX_EXECUTION_TEXT = 100_000
export const MAX_TOOL_RESULT = 20_000

export type RunStatus = 'running' | 'finished' | 'error' | 'cancelled'

export interface RunRecord {
  id: string
  status: RunStatus
  input: string
  output: string | null
  error: string | null
  warnings: string[]
  startedAt: string
  finishedAt: string | null
  executions: ExecutionView[]
}

export type RunSummary = Omit<RunRecord, 'executions'>

export interface StartRunOptions {
  runId: string
  graph: Graph
  input: string
  signal: AbortSignal
  emit: (event: RunEvent) => void
}

export interface RunServiceDeps {
  /** Runs the graph. Resolves when the run is over; the service never expects it to throw for a run error. */
  startRun(options: StartRunOptions): Promise<void>
  /** Sends an event to every interested window. */
  broadcast(event: RunEvent): void
}

interface Entry {
  id: string
  input: string
  startedAt: string
  finishedAt: string | null
  controller: AbortController
  state: RunState
  waiters: (() => void)[]
}

function toRecord(entry: Entry): RunRecord {
  const status: RunStatus = entry.state.status === 'idle' ? 'running' : entry.state.status
  return {
    id: entry.id,
    status,
    input: entry.input,
    output: entry.state.output,
    error: entry.state.error,
    warnings: entry.state.warnings,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    executions: entry.state.executions
  }
}

export class RunService {
  private entries = new Map<string, Entry>()

  constructor(private readonly deps: RunServiceDeps) {}

  start(graph: Graph, input: string): string {
    const runId = globalThis.crypto.randomUUID()
    const entry: Entry = {
      id: runId,
      input,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      controller: new AbortController(),
      state: { ...initialRunState, runId, status: 'running' },
      waiters: []
    }
    this.entries.set(runId, entry)
    this.evict()

    const emit = (event: RunEvent): void => {
      this.record(entry, event)
      this.deps.broadcast(event)
    }

    void this.deps
      .startRun({ runId, graph, input, signal: entry.controller.signal, emit })
      .catch((err: unknown) => {
        // The engine reports its own failures as events; this is the last resort.
        if (entry.state.status === 'running') emit({ type: 'run.error', runId, error: errorMessage(err) })
      })
      .finally(() => {
        if (entry.finishedAt === null) entry.finishedAt = new Date().toISOString()
        for (const waiter of entry.waiters.splice(0)) waiter()
        this.evict()
      })

    return runId
  }

  /** Aborts the run's signal. False when no run has that id, or the run is already finished. */
  stop(runId: string): boolean {
    const entry = this.entries.get(runId)
    if (!entry || entry.finishedAt !== null) return false
    entry.controller.abort()
    return true
  }

  stopAll(): void {
    for (const entry of this.entries.values()) entry.controller.abort()
  }

  get(runId: string): RunRecord | undefined {
    const entry = this.entries.get(runId)
    return entry ? toRecord(entry) : undefined
  }

  list(limit = MAX_RUNS): RunSummary[] {
    const records = [...this.entries.values()].reverse().slice(0, Math.max(0, limit))
    return records.map((entry) => {
      const { executions: _executions, ...summary } = toRecord(entry)
      return summary
    })
  }

  /** Resolves once the run is over, or with the still-running record when the timeout elapses. */
  wait(runId: string, timeoutMs: number): Promise<RunRecord | undefined> {
    const entry = this.entries.get(runId)
    if (!entry) return Promise.resolve(undefined)
    if (entry.finishedAt !== null) return Promise.resolve(toRecord(entry))
    return new Promise<RunRecord | undefined>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(toRecord(entry))
      }
      // setTimeout overflows its 32-bit delay past ~24.8 days; clamp rather than fire at once.
      const timer = setTimeout(finish, Math.min(Math.max(0, timeoutMs), 2_147_483_647))
      entry.waiters.push(finish)
    })
  }

  private record(entry: Entry, event: RunEvent): void {
    entry.state = applyRunEvent(entry.state, this.cap(entry, event))
    if (event.type === 'run.finished' || event.type === 'run.error' || event.type === 'run.cancelled') {
      if (entry.finishedAt === null) entry.finishedAt = new Date().toISOString()
    }
  }

  /** Keeps a long-running or noisy run from growing without bound. */
  private cap(entry: Entry, event: RunEvent): RunEvent {
    if (event.type === 'node.text') {
      const execution = entry.state.executions.find((e) => e.executionId === event.executionId)
      const length = execution?.text.length ?? 0
      if (length >= MAX_EXECUTION_TEXT) return { ...event, delta: '' }
      if (length + event.delta.length > MAX_EXECUTION_TEXT) {
        return { ...event, delta: `${event.delta.slice(0, MAX_EXECUTION_TEXT - length)}\n[truncated]` }
      }
      return event
    }
    if (event.type === 'node.tool.result' && event.content.length > MAX_TOOL_RESULT) {
      return { ...event, content: `${event.content.slice(0, MAX_TOOL_RESULT)}\n[truncated]` }
    }
    return event
  }

  /** Drops the oldest finished runs. A run still in flight is never evicted: its abort handle is the only way to stop it. */
  private evict(): void {
    if (this.entries.size <= MAX_RUNS) return
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= MAX_RUNS) return
      if (entry.finishedAt !== null) this.entries.delete(id)
    }
  }
}
