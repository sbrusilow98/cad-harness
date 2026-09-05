import type { Graph } from '@shared/types'

export interface ValidationIssue {
  level: 'error' | 'warning'
  message: string
  nodeId?: string
  edgeId?: string
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === 'error')
}

export function validateGraph(graph: Graph, knownServerIds?: Set<string>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const nodeIds = new Set(graph.nodes.map((n) => n.id))

  if (!graph.entryNodeId) {
    issues.push({ level: 'error', message: 'No entry node. Right-click a node and choose "Set as entry".' })
  } else if (!nodeIds.has(graph.entryNodeId)) {
    issues.push({ level: 'error', message: 'The entry node no longer exists.' })
  }

  for (const node of graph.nodes) {
    if (!node.name.trim()) {
      issues.push({ level: 'error', message: 'A node has no name.', nodeId: node.id })
    }
    if (!node.model.trim()) {
      issues.push({ level: 'error', message: `"${node.name}" has no model.`, nodeId: node.id })
    }
    if (knownServerIds) {
      for (const grant of node.tools) {
        if (!knownServerIds.has(grant.serverId)) {
          issues.push({
            level: 'warning',
            message: `"${node.name}" references an MCP server that is not configured.`,
            nodeId: node.id
          })
        }
      }
    }
  }

  const seen = new Set<string>()
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({ level: 'error', message: 'An edge references a node that does not exist.', edgeId: edge.id })
      continue
    }
    const key = `${edge.source}>${edge.target}:${edge.kind}`
    if (seen.has(key)) {
      issues.push({ level: 'error', message: `Duplicate ${edge.kind} edge between the same nodes.`, edgeId: edge.id })
    }
    seen.add(key)
  }

  if (graph.entryNodeId && nodeIds.has(graph.entryNodeId)) {
    const reachable = new Set<string>([graph.entryNodeId])
    const queue = [graph.entryNodeId]
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const edge of graph.edges) {
        if (edge.source === current && nodeIds.has(edge.target) && !reachable.has(edge.target)) {
          reachable.add(edge.target)
          queue.push(edge.target)
        }
      }
    }
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) {
        issues.push({ level: 'warning', message: `"${node.name}" is not reachable from the entry node.`, nodeId: node.id })
      }
    }
  }

  return issues
}
