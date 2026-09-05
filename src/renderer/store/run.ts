import { create } from 'zustand'
import type { EdgeKind } from '@shared/types'
import type { RunEvent } from '@shared/events'

export type NodeStatus = 'running' | 'done' | 'error'

export interface ToolCallView {
  callId: string
  name: string
  args: unknown
  result?: string
  isError?: boolean
}

export interface MarkerView {
  kind: EdgeKind
  edgeId: string
  message: string
}

export interface ExecutionView {
  executionId: string
  nodeId: string
  parentExecutionId: string | null
  depth: number
  input: string
  text: string
  toolCalls: ToolCallView[]
  markers: MarkerView[]
  status: NodeStatus
  error?: string
  output?: string
}

export interface RunState {
  runId: string | null
  status: 'idle' | 'running' | 'finished' | 'error' | 'cancelled'
  executions: ExecutionView[]
  output: string | null
  error: string | null
  warnings: string[]
  traversedEdgeIds: string[]
  nodeStatus: Record<string, NodeStatus>
}

export const initialRunState: RunState = {
  runId: null,
  status: 'idle',
  executions: [],
  output: null,
  error: null,
  warnings: [],
  traversedEdgeIds: [],
  nodeStatus: {}
}

function updateExecution(state: RunState, executionId: string, fn: (e: ExecutionView) => ExecutionView): RunState {
  const index = state.executions.findIndex((e) => e.executionId === executionId)
  if (index === -1) return state
  const executions = state.executions.slice()
  executions[index] = fn(executions[index])
  return { ...state, executions }
}

export function applyRunEvent(state: RunState, event: RunEvent): RunState {
  if (event.type === 'run.started') {
    return { ...initialRunState, runId: event.runId, status: 'running' }
  }
  if (event.runId !== state.runId) return state

  switch (event.type) {
    case 'run.warning':
      return { ...state, warnings: [...state.warnings, event.message] }
    case 'node.started':
      return {
        ...state,
        executions: [
          ...state.executions,
          {
            executionId: event.executionId,
            nodeId: event.nodeId,
            parentExecutionId: event.parentExecutionId,
            depth: event.depth,
            input: event.input,
            text: '',
            toolCalls: [],
            markers: [],
            status: 'running'
          }
        ],
        nodeStatus: { ...state.nodeStatus, [event.nodeId]: 'running' }
      }
    case 'node.text':
      return updateExecution(state, event.executionId, (e) => ({ ...e, text: e.text + event.delta }))
    case 'node.tool.call':
      return updateExecution(state, event.executionId, (e) => ({
        ...e,
        toolCalls: [...e.toolCalls, { callId: event.callId, name: event.name, args: event.args }]
      }))
    case 'node.tool.result':
      return updateExecution(state, event.executionId, (e) => ({
        ...e,
        toolCalls: e.toolCalls.map((c) => (c.callId === event.callId ? { ...c, result: event.content, isError: event.isError } : c))
      }))
    case 'node.finished': {
      const next = updateExecution(state, event.executionId, (e) => ({ ...e, status: 'done', output: event.output }))
      const exec = next.executions.find((e) => e.executionId === event.executionId)
      return exec ? { ...next, nodeStatus: { ...next.nodeStatus, [exec.nodeId]: 'done' } } : next
    }
    case 'node.error': {
      const next = updateExecution(state, event.executionId, (e) => ({ ...e, status: 'error', error: event.error }))
      const exec = next.executions.find((e) => e.executionId === event.executionId)
      return exec ? { ...next, nodeStatus: { ...next.nodeStatus, [exec.nodeId]: 'error' } } : next
    }
    case 'edge.traversed': {
      const next = updateExecution(state, event.fromExecutionId, (e) => ({
        ...e,
        markers: [...e.markers, { kind: event.kind, edgeId: event.edgeId, message: event.message }]
      }))
      return { ...next, traversedEdgeIds: [...next.traversedEdgeIds, event.edgeId] }
    }
    case 'run.finished':
      return { ...state, status: 'finished', output: event.output }
    case 'run.error':
      return { ...state, status: 'error', error: event.error }
    case 'run.cancelled':
      return { ...state, status: 'cancelled' }
    default:
      return state
  }
}

interface RunStore extends RunState {
  handleEvent(event: RunEvent): void
  reset(): void
}

export const useRunStore = create<RunStore>((set) => ({
  ...initialRunState,
  handleEvent(event) {
    set((state) => applyRunEvent(state, event))
  },
  reset() {
    set(initialRunState)
  }
}))
