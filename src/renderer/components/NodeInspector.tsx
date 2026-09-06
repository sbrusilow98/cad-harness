import { DEFAULT_MODELS, PROVIDER_IDS, PROVIDER_LABELS, type AgentNode, type ProviderId } from '@shared/types'
import { supportsTemperature } from '@shared/model-capabilities'
import { useGraphStore } from '@/store/graph'
import { ModelCombo } from './ModelCombo'
import { ToolPicker } from './ToolPicker'

interface NumberFieldProps {
  label: string
  value: number | undefined
  disabled?: boolean
  min?: number
  max?: number
  step?: number
  onChange: (value: number | undefined) => void
}

function NumberField({ label, value, min, max, step, disabled, onChange }: NumberFieldProps) {
  return (
    <div className="field number-field">
      <label className="label">{label}</label>
      <input
        className="input"
        type="number"
        value={disabled ? '' : (value ?? '')}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={disabled ? 'not supported' : 'default'}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </div>
  )
}

interface Props {
  node: AgentNode
}

export function NodeInspector({ node }: Props) {
  const isEntry = useGraphStore((s) => s.graph.entryNodeId === node.id)
  const allowsTemperature = supportsTemperature(node.provider, node.model)
  const update = (patch: Partial<AgentNode>): void => useGraphStore.getState().updateNode(node.id, patch)

  return (
    <>
      <div className="inspector-section">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="inspector-title" style={{ marginBottom: 0 }}>
            Agent
          </div>
          {isEntry ? (
            <span className="badge">ENTRY</span>
          ) : (
            <button type="button" className="btn btn-small" onClick={() => useGraphStore.getState().setEntry(node.id)}>
              Set as entry
            </button>
          )}
        </div>
        <div className="field">
          <label className="label">Name</label>
          <input className="input" value={node.name} onChange={(e) => update({ name: e.target.value })} />
        </div>
        <div className="field">
          <label className="label">Provider</label>
          <select
            className="select"
            value={node.provider}
            onChange={(e) => {
              const provider = e.target.value as ProviderId
              update({ provider, model: DEFAULT_MODELS[provider] })
            }}
          >
            {PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_LABELS[id]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label">Model</label>
          <ModelCombo provider={node.provider} value={node.model} onChange={(model) => update({ model })} />
        </div>
      </div>

      <div className="inspector-section">
        <div className="inspector-title">Instructions</div>
        <textarea
          className="textarea"
          value={node.instructions}
          spellCheck={false}
          placeholder="System prompt for this agent. Describe its role, what it should do, and when to hand off or delegate."
          onChange={(e) => update({ instructions: e.target.value })}
        />
      </div>

      <div className="inspector-section">
        <div className="inspector-title">Tools</div>
        <ToolPicker node={node} />
      </div>

      <div className="inspector-section">
        <div className="inspector-title">Sampling and limits</div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <NumberField
            label="Temperature"
            value={node.temperature}
            min={0}
            max={2}
            step={0.1}
            disabled={!allowsTemperature}
            onChange={(v) => update({ temperature: v })}
          />
          <NumberField label="Max tokens" value={node.maxTokens} min={1} step={1} onChange={(v) => update({ maxTokens: v })} />
          <NumberField label="Max turns" value={node.maxTurns} min={1} step={1} onChange={(v) => update({ maxTurns: v })} />
        </div>
        <div className="small faint">
          {allowsTemperature
            ? 'Blank uses the provider default.'
            : `${node.model} does not accept a temperature, so it is ignored for this agent.`}
        </div>
      </div>
    </>
  )
}
