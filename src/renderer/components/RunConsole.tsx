import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { useGraphStore } from '@/store/graph'
import { useUiStore } from '@/store/ui'
import { useRunStore, type ExecutionView } from '@/store/run'
import { describeError } from '@/lib/errors'
import { RUN_EVENT } from '@/lib/file-actions'
import { shortcut } from '@/lib/platform'

const STATUS_LABEL = { idle: 'Ready', running: 'Running', finished: 'Finished', error: 'Failed', cancelled: 'Stopped' } as const
const GLYPH = { running: '●', done: '✓', error: '!' } as const

function argsPreview(args: unknown): string {
  try {
    const text = JSON.stringify(args) ?? ''
    return text.length > 80 ? `${text.slice(0, 77)}…` : text
  } catch {
    return ''
  }
}

interface BlockProps {
  exec: ExecutionView
  nodeName: string
  edgeTarget: (edgeId: string) => string
}

const ExecutionBlock = memo(function ExecutionBlock({ exec, nodeName, edgeTarget }: BlockProps) {
  return (
    <div className="exec" style={{ '--depth': exec.depth } as CSSProperties}>
      <div className="exec-head">
        <span>{nodeName}</span>
        <span>{GLYPH[exec.status]}</span>
      </div>
      <div className="exec-input">› {exec.input}</div>
      {exec.text && <div className="exec-text">{exec.text}</div>}
      {exec.toolCalls.map((call) => (
        <details className={`tool-row${call.isError ? ' error' : ''}`} key={call.callId}>
          <summary>
            {call.result === undefined ? '… ' : ''}
            {call.name}({argsPreview(call.args)})
          </summary>
          <pre>{JSON.stringify(call.args, null, 2)}</pre>
          {call.result !== undefined && <pre>{call.result || '(empty result)'}</pre>}
        </details>
      ))}
      {exec.markers.map((m, i) => (
        <div className="marker" key={i}>
          {m.kind === 'handoff' ? '→ handoff to' : '↳ delegated to'} {edgeTarget(m.edgeId)}
        </div>
      ))}
      {exec.error && <div className="exec-error">{exec.error}</div>}
    </div>
  )
})

export function RunConsole() {
  const open = useUiStore((s) => s.consoleOpen)
  const height = useUiStore((s) => s.consoleHeight)
  const setHeight = useUiStore((s) => s.setConsoleHeight)
  const setOpen = useUiStore((s) => s.setConsoleOpen)
  const run = useRunStore()
  const graph = useGraphStore((s) => s.graph)
  const [input, setInput] = useState('')
  const [startError, setStartError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const atBottomRef = useRef(true)

  useEffect(() => window.api.onRunEvent(run.handleEvent), [run.handleEvent])

  const start = useCallback(async () => {
    const text = input.trim()
    if (!text) {
      setHint('Type a message for the entry agent first.')
      inputRef.current?.focus()
      return
    }
    if (useRunStore.getState().status === 'running') return
    setHint(null)
    setStartError(null)
    try {
      await window.api.startRun(useGraphStore.getState().graph, text)
    } catch (err) {
      setStartError(describeError(err))
    }
  }, [input])

  const stop = useCallback(() => {
    const id = useRunStore.getState().runId
    if (id) void window.api.stopRun(id)
  }, [])

  // Keep the latest `start` in a ref so the listener subscribes only once
  // instead of re-subscribing on every keystroke.
  const startRef = useRef(start)
  startRef.current = start

  useEffect(() => {
    const handler = (): void => {
      void startRef.current()
    }
    window.addEventListener(RUN_EVENT, handler)
    return () => window.removeEventListener(RUN_EVENT, handler)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    const el = bodyRef.current
    // Only follow the tail when the reader was already at it; otherwise a long
    // run would yank them back down while they read earlier output.
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [run.executions, run.output, run.error, run.status])

  const onBodyScroll = (): void => {
    const el = bodyRef.current
    if (el) atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 40
  }

  const nodeName = useCallback(
    (id: string): string => graph.nodes.find((n) => n.id === id)?.name ?? 'Unknown agent',
    [graph.nodes]
  )
  // Stable across text deltas so the memoised blocks are not all re-rendered.
  const edgeTarget = useCallback(
    (edgeId: string): string => {
      const edge = graph.edges.find((e) => e.id === edgeId)
      return edge ? nodeName(edge.target) : '?'
    },
    [graph.edges, nodeName]
  )

  const onResizeStart = (e: ReactMouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height
    const move = (ev: MouseEvent): void => setHeight(startHeight + (startY - ev.clientY))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (!open) return null

  const running = run.status === 'running'

  return (
    <section className="console" style={{ height }}>
      <div className="console-resize" onMouseDown={onResizeStart} />
      <div className="console-header">
        <span>Run</span>
        <span className="muted">· {STATUS_LABEL[run.status]}</span>
        <span className="spacer" />
        {running && (
          <button type="button" className="btn btn-small" onClick={stop}>
            Stop
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-icon btn-small" onClick={() => setOpen(false)} title={`Hide console (${shortcut('J')})`}>
          ×
        </button>
      </div>
      <div className="console-body" ref={bodyRef} onScroll={onBodyScroll}>
        {run.warnings.map((w, i) => (
          <div key={i} className="warning-line">
            ⚠ {w}
          </div>
        ))}
        {run.executions.length === 0 && run.status === 'idle' && !startError && (
          <div className="faint">Type a message below and press {shortcut('Enter')} to run the graph from its entry node.</div>
        )}
        {run.executions.map((exec) => (
          <ExecutionBlock key={exec.executionId} exec={exec} nodeName={nodeName(exec.nodeId)} edgeTarget={edgeTarget} />
        ))}
        {run.status === 'finished' && (
          <div className="run-output">
            <div className="exec-head">Result</div>
            {run.output || <span className="faint">(empty)</span>}
          </div>
        )}
        {run.status === 'error' && <div className="run-output exec-error">{run.error}</div>}
        {run.status === 'cancelled' && <div className="run-output muted">Run stopped.</div>}
        {startError && <div className="run-output exec-error">{startError}</div>}
        {hint && <div className="run-output muted">{hint}</div>}
      </div>
      <div className="console-input">
        <textarea
          ref={inputRef}
          className="textarea"
          value={input}
          placeholder="Message for the entry agent…"
          spellCheck={false}
          onChange={(e) => {
            setInput(e.target.value)
            setHint(null)
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void start()
            }
          }}
        />
        {running ? (
          <button type="button" className="btn" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void start()}>
            Run
          </button>
        )}
      </div>
    </section>
  )
}
