import { useGraphStore } from '@/store/graph'
import { useUiStore } from '@/store/ui'
import { NodeInspector } from './NodeInspector'
import { EdgeInspector } from './EdgeInspector'

export function Inspector() {
  const selection = useUiStore((s) => s.selection)
  const graph = useGraphStore((s) => s.graph)
  if (!selection) return null

  if (selection.type === 'node') {
    const node = graph.nodes.find((n) => n.id === selection.id)
    if (!node) return null
    return (
      <aside className="inspector">
        <NodeInspector key={node.id} node={node} />
      </aside>
    )
  }

  const edge = graph.edges.find((e) => e.id === selection.id)
  if (!edge) return null
  return (
    <aside className="inspector">
      <EdgeInspector key={edge.id} edge={edge} />
    </aside>
  )
}
