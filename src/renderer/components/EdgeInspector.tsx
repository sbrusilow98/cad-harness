import type { GraphEdge } from '@shared/types'
import { useGraphStore } from '@/store/graph'

interface Props {
  edge: GraphEdge
}

export function EdgeInspector({ edge }: Props) {
  const nodes = useGraphStore((s) => s.graph.nodes)
  const update = (patch: Partial<GraphEdge>): void => useGraphStore.getState().updateEdge(edge.id, patch)
  const source = nodes.find((n) => n.id === edge.source)?.name ?? '?'
  const target = nodes.find((n) => n.id === edge.target)?.name ?? '?'

  return (
    <div className="inspector-section">
      <div className="inspector-title">Edge</div>
      <div className="small muted" style={{ marginBottom: 12 }}>
        {source} → {target}
      </div>
      <div className="field">
        <span className="label">Kind</span>
        <div>
          <div className="segmented">
            <button type="button" className={edge.kind === 'handoff' ? 'active' : ''} onClick={() => update({ kind: 'handoff' })}>
              Handoff
            </button>
            <button type="button" className={edge.kind === 'delegate' ? 'active' : ''} onClick={() => update({ kind: 'delegate' })}>
              Delegate
            </button>
          </div>
        </div>
        <div className="small faint">
          {edge.kind === 'handoff'
            ? `${source} finishes, then ${target} runs with the message it passes along.`
            : `${source} can call ${target} as a tool mid-conversation and gets its result back.`}
        </div>
      </div>
      <div className="field">
        <label className="label">Description</label>
        <textarea
          className="textarea"
          style={{ minHeight: 70 }}
          value={edge.description ?? ''}
          spellCheck={false}
          placeholder={edge.kind === 'handoff' ? 'When should the model choose this route?' : 'What is this agent good for?'}
          onChange={(e) => update({ description: e.target.value })}
        />
        <div className="small faint">Shown to the model as the tool description.</div>
      </div>
    </div>
  )
}
