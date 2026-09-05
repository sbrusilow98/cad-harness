import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'
import type { GraphEdge } from '@shared/types'

export type GraphEdgeData = { edge: GraphEdge; traversed: boolean }
export type GraphFlowEdge = Edge<GraphEdgeData, 'graph'>

export function GraphEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd
}: EdgeProps<GraphFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const kind = data?.edge.kind ?? 'handoff'
  const description = data?.edge.description?.trim()
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={data?.traversed ? 'traversed' : undefined}
        style={{ strokeDasharray: kind === 'delegate' ? '6 4' : undefined }}
      />
      {description && (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={description}
          >
            {description}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
