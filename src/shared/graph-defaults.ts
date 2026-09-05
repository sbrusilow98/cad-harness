import { DEFAULT_MODELS, type AgentNode, type Graph, type Position } from './types'

export function newId(): string {
  return globalThis.crypto.randomUUID()
}

export function emptyGraph(name = 'Untitled'): Graph {
  return { version: 1, name, entryNodeId: null, nodes: [], edges: [] }
}

export function createAgentNode(position: Position, overrides: Partial<AgentNode> = {}): AgentNode {
  return {
    id: newId(),
    name: 'Agent',
    position,
    provider: 'anthropic',
    model: DEFAULT_MODELS.anthropic,
    instructions: '',
    tools: [],
    ...overrides
  }
}
