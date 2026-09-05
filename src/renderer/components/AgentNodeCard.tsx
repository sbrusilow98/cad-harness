import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { PROVIDER_LABELS, type AgentNode } from '@shared/types'
import type { NodeStatus } from '@/store/run'

export type AgentNodeData = { node: AgentNode; isEntry: boolean; status?: NodeStatus; warning: boolean }
export type AgentFlowNode = Node<AgentNodeData, 'agent'>

export function toolSummary(node: AgentNode): string {
  if (node.tools.length === 0) return 'no tools'
  const all = node.tools.filter((t) => t.names === '*').length
  const named = node.tools.reduce((n, t) => (t.names === '*' ? n : n + t.names.length), 0)
  if (all > 0) {
    const servers = `${all} server${all === 1 ? '' : 's'}`
    return named > 0 ? `all tools · ${servers} + ${named}` : `all tools · ${servers}`
  }
  return `${named} tool${named === 1 ? '' : 's'}`
}

const GLYPH: Record<NodeStatus, string> = { running: '●', done: '✓', error: '!' }

export function AgentNodeCard({ data }: NodeProps<AgentFlowNode>) {
  const { node, isEntry, status, warning } = data
  return (
    <div className={`agent-node${status ? ` status-${status}` : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="agent-node-head">
        <span className="agent-node-name" title={node.name}>
          {node.name.trim() || 'Untitled'}
        </span>
        {isEntry && <span className="badge">ENTRY</span>}
      </div>
      <div className="agent-node-meta" title={node.model}>
        {PROVIDER_LABELS[node.provider]} · {node.model}
      </div>
      <div className="agent-node-foot">
        <span>
          {toolSummary(node)}
          {warning ? ' · missing server' : ''}
        </span>
        <span>{status ? GLYPH[status] : ''}</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
