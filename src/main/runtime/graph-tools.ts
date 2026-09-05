import type { AgentNode, Graph, GraphEdge } from '@shared/types'
import type { ToolDef } from '../providers/types'
import { sanitizeToolName, uniqueName, type ToolNameRegistry, type ToolRef } from '../mcp/naming'

export const HANDOFF_TOOL = 'handoff'

export interface McpToolInfo {
  serverId: string
  serverName: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface NodeToolSet {
  defs: ToolDef[]
  mcp: Map<string, ToolRef>
  delegates: Map<string, GraphEdge>
  handoffTargets: Map<string, GraphEdge> | null
  autoHandoff: GraphEdge | null
}

export function buildNodeToolSet(
  graph: Graph,
  node: AgentNode,
  available: McpToolInfo[],
  registry: ToolNameRegistry
): NodeToolSet {
  const defs: ToolDef[] = []
  const mcp = new Map<string, ToolRef>()
  const delegates = new Map<string, GraphEdge>()
  const taken = (name: string): boolean => defs.some((d) => d.name === name)

  for (const grant of node.tools) {
    for (const tool of available) {
      if (tool.serverId !== grant.serverId) continue
      if (grant.names !== '*' && !grant.names.includes(tool.name)) continue
      const exposed = registry.register(tool.serverName, { serverId: tool.serverId, toolName: tool.name })
      if (mcp.has(exposed)) continue
      mcp.set(exposed, { serverId: tool.serverId, toolName: tool.name })
      defs.push({
        name: exposed,
        description: tool.description.trim() || `Tool ${tool.name} from ${tool.serverName}`,
        inputSchema: tool.inputSchema
      })
    }
  }

  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]))
  const outgoing = graph.edges.filter((e) => e.source === node.id && nodesById.has(e.target))

  for (const edge of outgoing.filter((e) => e.kind === 'delegate')) {
    const child = nodesById.get(edge.target)!
    const name = uniqueName(`delegate_to_${sanitizeToolName(child.name).toLowerCase()}`, taken)
    delegates.set(name, edge)
    defs.push({
      name,
      description: edge.description?.trim() || `Delegate a task to the "${child.name}" agent and get its result back.`,
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The task or question to hand to this agent. Include all context it needs.' }
        },
        required: ['task']
      }
    })
  }

  const handoffs = outgoing.filter((e) => e.kind === 'handoff')
  let handoffTargets: Map<string, GraphEdge> | null = null
  let autoHandoff: GraphEdge | null = null

  if (handoffs.length === 1) {
    autoHandoff = handoffs[0]
  } else if (handoffs.length >= 2) {
    const targets = new Map<string, GraphEdge>()
    const options: string[] = []
    for (const edge of handoffs) {
      const child = nodesById.get(edge.target)!
      const label = uniqueName(child.name.trim() || 'Agent', (n) => targets.has(n), 200)
      targets.set(label, edge)
      const desc = edge.description?.trim()
      options.push(desc ? `${label}: ${desc}` : label)
    }
    handoffTargets = targets
    defs.push({
      name: HANDOFF_TOOL,
      description:
        'Finish your work and hand the conversation off to another agent. Choose the target that fits. Options:\n' +
        options.map((o) => `- ${o}`).join('\n'),
      inputSchema: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: [...targets.keys()], description: 'The agent to hand off to.' },
          message: { type: 'string', description: 'The message the target agent receives. Include everything it needs.' }
        },
        required: ['target', 'message']
      }
    })
  }

  return { defs, mcp, delegates, handoffTargets, autoHandoff }
}
