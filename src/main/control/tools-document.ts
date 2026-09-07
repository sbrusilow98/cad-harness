import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { PROVIDER_IDS, type Graph } from '@shared/types'
import { emptyGraph } from '@shared/graph-defaults'
import {
  addAgent,
  connect,
  disconnect,
  removeAgent,
  setEntry,
  setGraphName,
  updateAgent,
  updateEdgeOp,
  type OpsResult
} from '@shared/graph-ops'
import { errorMessage } from '@shared/errors'
import { validateGraph } from '../runtime/validate'
import type { OpenDocument } from '../document-service'
import type { ControlDeps } from './deps'
import { fail, ok } from './result'

const provider = z.enum(PROVIDER_IDS as [string, ...string[]])
const position = z.object({ x: z.number(), y: z.number() })
const toolGrant = z.object({ serverId: z.string(), names: z.union([z.literal('*'), z.array(z.string())]) })
const edgeKind = z.enum(['handoff', 'delegate'])

/** The JSON view of the document, with edge endpoints named so it reads on its own. */
export function describeDocument(document: OpenDocument): unknown {
  const { graph } = document
  const nameOf = (id: string): string => graph.nodes.find((n) => n.id === id)?.name ?? id
  return {
    name: graph.name,
    path: document.path,
    dirty: document.dirty,
    entryAgentId: graph.entryNodeId,
    agents: graph.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      provider: node.provider,
      model: node.model,
      instructions: node.instructions,
      tools: node.tools,
      position: node.position,
      temperature: node.temperature,
      maxTokens: node.maxTokens,
      maxTurns: node.maxTurns
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: nameOf(edge.source),
      fromId: edge.source,
      to: nameOf(edge.target),
      toId: edge.target,
      kind: edge.kind,
      description: edge.description
    }))
  }
}

function describeEdge(document: OpenDocument, edgeId: string): unknown {
  const described = describeDocument(document) as { edges: { id: string }[] }
  return described.edges.find((e) => e.id === edgeId)
}

export function registerDocumentTools(server: McpServer, deps: ControlDeps): void {
  /** Applies a graph operation and answers with `select` over the resulting document. */
  const apply = <T>(fn: (graph: Graph) => OpsResult<T>, select: (value: T, document: OpenDocument) => unknown): CallToolResult => {
    const result = deps.document.mutate(fn)
    return result.ok ? ok(select(result.value, result.document)) : fail(result.error)
  }

  server.registerTool(
    'get_graph',
    { description: 'Read the graph currently open in the app: its agents, edges, entry agent, file path, and whether it has unsaved changes.' },
    () => ok(describeDocument(deps.document.get()))
  )

  server.registerTool(
    'new_graph',
    { description: 'Replace the open graph with an empty one. Unsaved changes are discarded.', inputSchema: { name: z.string().optional() } },
    ({ name }) => ok(describeDocument(deps.document.replace(emptyGraph(name?.trim() || 'Untitled'), null, false)))
  )

  server.registerTool(
    'open_graph',
    { description: 'Open a graph file from disk and show it in the app. Unsaved changes are discarded.', inputSchema: { path: z.string() } },
    async ({ path }) => {
      try {
        const graph = await deps.readGraphFile(path)
        return ok(describeDocument(deps.document.replace(graph, path, false)))
      } catch (err) {
        return fail(errorMessage(err))
      }
    }
  )

  server.registerTool(
    'save_graph',
    {
      description: 'Save the open graph. Uses its existing path unless one is given.',
      inputSchema: { path: z.string().optional() }
    },
    async ({ path }) => {
      const before = deps.document.get()
      const target = path?.trim() || before.path
      if (!target) return fail('This graph has no path yet. Call save_graph again with a path.')
      try {
        await deps.writeGraphFile(target, before.graph)
      } catch (err) {
        return fail(errorMessage(err))
      }
      const after = deps.document.get()
      if (after.revision === before.revision) {
        deps.document.replace(before.graph, target, false)
        return ok({ path: target, saved: true })
      }
      // The window changed the graph while it was being written. Keep the newer one and stay dirty.
      deps.document.replace(after.graph, target, true)
      return ok({
        path: target,
        saved: true,
        note: 'The graph changed while it was being written, so the file on disk is older than what is open. It is still marked as having unsaved changes.'
      })
    }
  )

  server.registerTool(
    'set_graph_name',
    { description: 'Rename the open graph.', inputSchema: { name: z.string() } },
    ({ name }) => apply((graph) => setGraphName(graph, name), (_value, document) => describeDocument(document))
  )

  server.registerTool(
    'add_agent',
    {
      description:
        'Add an agent to the graph. Defaults to Anthropic and that provider default model, and is placed automatically unless a position is given. The first agent added becomes the entry agent.',
      inputSchema: {
        name: z.string(),
        provider: provider.optional(),
        model: z.string().optional(),
        instructions: z.string().optional(),
        tools: z.array(toolGrant).optional(),
        position: position.optional(),
        entry: z.boolean().optional(),
        temperature: z.number().optional(),
        maxTokens: z.number().optional(),
        maxTurns: z.number().optional()
      }
    },
    (args) =>
      apply(
        (graph) => addAgent(graph, args as Parameters<typeof addAgent>[1]),
        (node) => node
      )
  )

  server.registerTool(
    'update_agent',
    {
      description:
        'Change an agent. Give it by id or by name. Only the fields you pass are changed; passing null for temperature, maxTokens, or maxTurns clears that field.',
      inputSchema: {
        agent: z.string(),
        name: z.string().optional(),
        provider: provider.optional(),
        model: z.string().optional(),
        instructions: z.string().optional(),
        tools: z.array(toolGrant).optional(),
        position: position.optional(),
        temperature: z.number().nullable().optional(),
        maxTokens: z.number().nullable().optional(),
        maxTurns: z.number().nullable().optional()
      }
    },
    ({ agent, ...patch }) => apply((graph) => updateAgent(graph, agent, patch as Parameters<typeof updateAgent>[2]), (node) => node)
  )

  server.registerTool(
    'remove_agent',
    { description: 'Remove an agent and every edge attached to it.', inputSchema: { agent: z.string() } },
    ({ agent }) => apply((graph) => removeAgent(graph, agent), (value) => value)
  )

  server.registerTool(
    'set_entry',
    { description: 'Choose the agent a run starts from.', inputSchema: { agent: z.string() } },
    ({ agent }) => apply((graph) => setEntry(graph, agent), (_value, document) => describeDocument(document))
  )

  server.registerTool(
    'connect',
    {
      description:
        'Join two agents. A handoff passes control and a message onward; a delegate lets the source call the target as a tool and get its result back. The description is what the model reads when choosing the route.',
      inputSchema: { from: z.string(), to: z.string(), kind: edgeKind, description: z.string().optional() }
    },
    ({ from, to, kind, description }) =>
      apply(
        (graph) => connect(graph, from, to, kind, description),
        (edge, document) => describeEdge(document, edge.id)
      )
  )

  server.registerTool(
    'update_edge',
    {
      description: 'Change an edge. Give it by id or as "Source->Target".',
      inputSchema: { edge: z.string(), kind: edgeKind.optional(), description: z.string().optional() }
    },
    ({ edge, kind, description }) =>
      apply(
        (graph) => updateEdgeOp(graph, edge, { kind, description }),
        (updated, document) => describeEdge(document, updated.id)
      )
  )

  server.registerTool(
    'disconnect',
    { description: 'Remove an edge. Give it by id or as "Source->Target".', inputSchema: { edge: z.string() } },
    ({ edge }) => apply((graph) => disconnect(graph, edge), (value) => value)
  )

  server.registerTool(
    'validate_graph',
    { description: 'Check the open graph for problems that would stop or spoil a run.' },
    () => {
      const issues = validateGraph(deps.document.get().graph)
      return ok({ ok: !issues.some((i) => i.level === 'error'), issues })
    }
  )
}
