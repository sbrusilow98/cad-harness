import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { AgentNode, GraphEdge } from '@shared/types'
import { useGraphStore } from '@/store/graph'
import { useUiStore } from '@/store/ui'
import { useRunStore, type NodeStatus } from '@/store/run'
import { AgentNodeCard, type AgentFlowNode } from './AgentNodeCard'
import { GraphEdgeView, type GraphFlowEdge } from './GraphEdgeView'
import { ContextMenu, type MenuItem } from './ContextMenu'

const nodeTypes: NodeTypes = { agent: AgentNodeCard }
const edgeTypes: EdgeTypes = { graph: GraphEdgeView }

const NODE_WIDTH = 220
const NODE_HEIGHT = 74

function toFlowNode(
  node: AgentNode,
  isEntry: boolean,
  status: NodeStatus | undefined,
  warning: boolean,
  fresh: string | null,
  prev: AgentFlowNode | undefined
): AgentFlowNode {
  return {
    id: node.id,
    type: 'agent',
    position: prev?.dragging ? prev.position : node.position,
    data: { node, isEntry, status, warning },
    selected: fresh !== null ? node.id === fresh : (prev?.selected ?? false),
    dragging: prev?.dragging,
    measured: prev?.measured
  }
}

function toFlowEdge(edge: GraphEdge, traversed: boolean, markerColor: string, prev: GraphFlowEdge | undefined): GraphFlowEdge {
  return {
    id: edge.id,
    type: 'graph',
    source: edge.source,
    target: edge.target,
    data: { edge, traversed },
    selected: prev?.selected ?? false,
    markerEnd: { type: MarkerType.ArrowClosed, color: markerColor, width: 16, height: 16 }
  }
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

function CanvasInner() {
  const graph = useGraphStore((s) => s.graph)
  const settings = useUiStore((s) => s.settings)
  const selection = useUiStore((s) => s.selection)
  const select = useUiStore((s) => s.select)
  const nodeStatus = useRunStore((s) => s.nodeStatus)
  const traversed = useRunStore((s) => s.traversedEdgeIds)
  const fitViewRequest = useUiStore((s) => s.fitViewRequest)
  const { screenToFlowPosition, fitView } = useReactFlow()

  const theme = settings?.theme ?? 'dark'
  const markerColor = theme === 'dark' ? '#6f6f6f' : '#8f8f8f'
  const knownServers = useMemo(() => new Set((settings?.mcpServers ?? []).map((s) => s.id)), [settings?.mcpServers])

  const [nodes, setNodes, onNodesChange] = useNodesState<AgentFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<GraphFlowEdge>([])
  const [menu, setMenu] = useState<MenuState | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((p) => [p.id, p]))
      const fresh = selection?.type === 'node' && !prevById.has(selection.id) ? selection.id : null
      return graph.nodes.map((n) =>
        toFlowNode(
          n,
          graph.entryNodeId === n.id,
          nodeStatus[n.id],
          settings !== null && n.tools.some((t) => !knownServers.has(t.serverId)),
          fresh,
          prevById.get(n.id)
        )
      )
    })
  }, [graph.nodes, graph.entryNodeId, nodeStatus, knownServers, settings, selection, setNodes])

  useEffect(() => {
    setEdges((prev) => {
      const prevById = new Map(prev.map((p) => [p.id, p]))
      const traversedSet = new Set(traversed)
      return graph.edges.map((e) => toFlowEdge(e, traversedSet.has(e.id), markerColor, prevById.get(e.id)))
    })
  }, [graph.edges, traversed, markerColor, setEdges])

  useEffect(() => {
    if (fitViewRequest > 0) {
      const timeout = window.setTimeout(() => {
        fitView({ padding: 0.2, duration: 200 })
      }, 50)
      return () => window.clearTimeout(timeout)
    }
    return undefined
  }, [fitViewRequest, fitView])

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source && connection.target) useGraphStore.getState().addEdge(connection.source, connection.target)
  }, [])

  const onNodeDragStop = useCallback((_event: MouseEvent | TouchEvent, _node: AgentFlowNode, dragged: AgentFlowNode[]) => {
    const { moveNode } = useGraphStore.getState()
    for (const n of dragged) moveNode(n.id, n.position)
  }, [])

  const onNodesDelete = useCallback((deleted: AgentFlowNode[]) => {
    useGraphStore.getState().removeNodes(deleted.map((n) => n.id))
  }, [])

  const onEdgesDelete = useCallback((deleted: GraphFlowEdge[]) => {
    useGraphStore.getState().removeEdges(deleted.map((e) => e.id))
  }, [])

  const onSelectionChange = useCallback(
    ({ nodes: n, edges: e }: { nodes: Node[]; edges: Edge[] }) => {
      if (n.length === 1 && e.length === 0) select({ type: 'node', id: n[0].id })
      else if (e.length === 1 && n.length === 0) select({ type: 'edge', id: e[0].id })
      else select(null)
    },
    [select]
  )

  const addNodeAt = useCallback(
    (clientX: number, clientY: number) => {
      const position = screenToFlowPosition({ x: clientX, y: clientY })
      const node = useGraphStore.getState().addNode({ x: position.x - NODE_WIDTH / 2, y: position.y - NODE_HEIGHT / 2 })
      select({ type: 'node', id: node.id })
    },
    [screenToFlowPosition, select]
  )

  const onDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (!(event.target as HTMLElement).classList.contains('react-flow__pane')) return
      addNodeAt(event.clientX, event.clientY)
    },
    [addNodeAt]
  )

  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault()
      const { clientX, clientY } = event
      setMenu({ x: clientX, y: clientY, items: [{ label: 'Add agent here', onClick: () => addNodeAt(clientX, clientY) }] })
    },
    [addNodeAt]
  )

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: AgentFlowNode) => {
      event.preventDefault()
      const store = useGraphStore.getState()
      setMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          { label: 'Set as entry', disabled: store.graph.entryNodeId === node.id, onClick: () => store.setEntry(node.id) },
          {
            label: 'Duplicate',
            onClick: () => {
              const copy = store.duplicateNode(node.id)
              if (copy) select({ type: 'node', id: copy.id })
            }
          },
          {
            label: 'Delete',
            onClick: () => {
              store.removeNodes([node.id])
              const currentSelection = useUiStore.getState().selection
              if (currentSelection?.type === 'node' && currentSelection.id === node.id) select(null)
            }
          }
        ]
      })
    },
    [select]
  )

  const onEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: GraphFlowEdge) => {
      event.preventDefault()
      const store = useGraphStore.getState()
      const current = store.graph.edges.find((e) => e.id === edge.id)
      if (!current) return
      const flipped = current.kind === 'handoff' ? 'delegate' : 'handoff'
      setMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          { label: `Change to ${flipped}`, onClick: () => store.updateEdge(edge.id, { kind: flipped }) },
          {
            label: 'Delete',
            onClick: () => {
              store.removeEdges([edge.id])
              const currentSelection = useUiStore.getState().selection
              if (currentSelection?.type === 'edge' && currentSelection.id === edge.id) select(null)
            }
          }
        ]
      })
    },
    [select]
  )

  return (
    <div className="canvas" onDoubleClick={onDoubleClick}>
      <ReactFlow<AgentFlowNode, GraphFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onSelectionChange={onSelectionChange}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        fitView
        zoomOnDoubleClick={false}
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.2}
        maxZoom={2}
        colorMode={theme}
        defaultEdgeOptions={{ type: 'graph' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color={theme === 'dark' ? '#2a2a2a' : '#d9d9d9'} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      {graph.nodes.length === 0 && <div className="canvas-hint">Double-click to add an agent</div>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </div>
  )
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
