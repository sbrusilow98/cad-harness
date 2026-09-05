import type { EdgeKind } from './types'

export type RunEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'run.warning'; runId: string; message: string }
  | {
      type: 'node.started'
      runId: string
      executionId: string
      nodeId: string
      parentExecutionId: string | null
      input: string
      depth: number
    }
  | { type: 'node.text'; runId: string; executionId: string; delta: string }
  | { type: 'node.tool.call'; runId: string; executionId: string; callId: string; name: string; args: unknown }
  | { type: 'node.tool.result'; runId: string; executionId: string; callId: string; content: string; isError: boolean }
  | { type: 'node.finished'; runId: string; executionId: string; output: string }
  | { type: 'node.error'; runId: string; executionId: string; error: string }
  | {
      type: 'edge.traversed'
      runId: string
      fromExecutionId: string
      edgeId: string
      kind: EdgeKind
      message: string
    }
  | { type: 'run.finished'; runId: string; output: string }
  | { type: 'run.error'; runId: string; error: string }
  | { type: 'run.cancelled'; runId: string }
