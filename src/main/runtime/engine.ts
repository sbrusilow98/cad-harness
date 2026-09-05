import type { AgentNode, Graph, GraphEdge, ProviderId, RunLimits, ToolGrant } from '@shared/types'
import type { RunEvent } from '@shared/events'
import { textOf, toolCallsOf, type ChatProvider, type Message, type ToolCallPart, type ToolResult } from '../providers/types'
import { ToolNameRegistry, type ToolRef } from '../mcp/naming'
import { buildNodeToolSet, HANDOFF_TOOL, type McpToolInfo, type NodeToolSet } from './graph-tools'
import { hasErrors, validateGraph } from './validate'
import { errorMessage } from '@shared/errors'

export interface EngineDeps {
  getProvider(id: ProviderId): ChatProvider
  getApiKey(id: ProviderId): Promise<string | null>
  listMcpTools(grants: ToolGrant[], signal: AbortSignal): Promise<McpListing>
  callMcpTool(ref: ToolRef, args: unknown, signal: AbortSignal): Promise<{ content: string; isError: boolean }>
  limits: RunLimits
  emit(event: RunEvent): void
}

export interface RunOptions {
  runId: string
  graph: Graph
  input: string
  signal: AbortSignal
  deps: EngineDeps
}

class RunCancelled extends Error {
  constructor() {
    super('Run cancelled')
  }
}

class RunLimitReached extends Error {}

export interface McpListing {
  tools: McpToolInfo[]
  warnings: string[]
}

interface RunContext {
  runId: string
  graph: Graph
  signal: AbortSignal
  deps: EngineDeps
  steps: number
  registry: ToolNameRegistry
  nodesById: Map<string, AgentNode>
  listings: Map<string, McpListing>
  warned: Set<string>
}

interface NodeResult {
  executionId: string
  output: string
  handoff?: { edge: GraphEdge; message: string }
}

export async function runGraph(opts: RunOptions): Promise<void> {
  const { runId, graph, input, signal, deps } = opts
  deps.emit({ type: 'run.started', runId })

  const issues = validateGraph(graph)
  if (hasErrors(issues)) {
    const error = issues
      .filter((i) => i.level === 'error')
      .map((i) => i.message)
      .join(' ')
    deps.emit({ type: 'run.error', runId, error })
    return
  }

  const ctx: RunContext = {
    runId,
    graph,
    signal,
    deps,
    steps: 0,
    registry: new ToolNameRegistry(),
    nodesById: new Map(graph.nodes.map((n) => [n.id, n])),
    listings: new Map(),
    warned: new Set()
  }

  try {
    const entry = ctx.nodesById.get(graph.entryNodeId!)!
    const output = await executeFlow(ctx, entry, input, null, 0)
    deps.emit({ type: 'run.finished', runId, output })
  } catch (err) {
    if (err instanceof RunCancelled || signal.aborted) {
      deps.emit({ type: 'run.cancelled', runId })
    } else {
      deps.emit({ type: 'run.error', runId, error: errorMessage(err) })
    }
  }
}

const NO_OUTPUT = '(no output)'

function listingKey(node: AgentNode): string {
  return [...new Set(node.tools.map((g) => g.serverId))].sort().join(',')
}

async function listMcpToolsCached(ctx: RunContext, node: AgentNode): Promise<McpListing> {
  const key = listingKey(node)
  const cached = ctx.listings.get(key)
  if (cached) return cached
  const listing = await ctx.deps.listMcpTools(node.tools, ctx.signal)
  ctx.listings.set(key, listing)
  return listing
}

function resolveHandoffTarget(targets: Map<string, GraphEdge>, target: string): GraphEdge | undefined {
  const exact = targets.get(target)
  if (exact) return exact
  const wanted = target.trim().toLowerCase()
  for (const [label, edge] of targets) {
    if (label.trim().toLowerCase() === wanted) return edge
  }
  return undefined
}

function throwIfCancelled(ctx: RunContext): void {
  if (ctx.signal.aborted) throw new RunCancelled()
}

async function executeFlow(
  ctx: RunContext,
  start: AgentNode,
  input: string,
  parentExecutionId: string | null,
  depth: number
): Promise<string> {
  let node = start
  let message = input
  for (;;) {
    const result = await executeNode(ctx, node, message, parentExecutionId, depth)
    if (!result.handoff) return result.output
    const { edge, message: next } = result.handoff
    ctx.deps.emit({
      type: 'edge.traversed',
      runId: ctx.runId,
      fromExecutionId: result.executionId,
      edgeId: edge.id,
      kind: 'handoff',
      message: next
    })
    node = ctx.nodesById.get(edge.target)!
    message = next
  }
}

async function executeNode(
  ctx: RunContext,
  node: AgentNode,
  input: string,
  parentExecutionId: string | null,
  depth: number
): Promise<NodeResult> {
  const { deps, runId } = ctx
  const executionId = globalThis.crypto.randomUUID()
  deps.emit({ type: 'node.started', runId, executionId, nodeId: node.id, parentExecutionId, input, depth })

  try {
    const apiKey = await deps.getApiKey(node.provider)
    if (!apiKey) throw new Error(`No API key configured for ${node.provider}. Add one in Settings.`)
    const provider = deps.getProvider(node.provider)

    const listing = await listMcpToolsCached(ctx, node)
    throwIfCancelled(ctx)
    for (const message of listing.warnings) {
      if (ctx.warned.has(message)) continue
      ctx.warned.add(message)
      deps.emit({ type: 'run.warning', runId, message })
    }
    const toolSet = buildNodeToolSet(ctx.graph, node, listing.tools, ctx.registry)

    const messages: Message[] = [{ role: 'user', content: input }]
    const maxTurns = Math.max(1, Math.floor(node.maxTurns ?? deps.limits.maxTurns))
    const maxTokens =
      typeof node.maxTokens === 'number' && Number.isFinite(node.maxTokens) && node.maxTokens >= 1
        ? Math.floor(node.maxTokens)
        : undefined
    const temperature =
      typeof node.temperature === 'number' &&
      Number.isFinite(node.temperature) &&
      node.temperature >= 0 &&
      node.temperature <= 2
        ? node.temperature
        : undefined

    for (let turn = 0; turn < maxTurns; turn++) {
      throwIfCancelled(ctx)
      if (++ctx.steps > deps.limits.maxTotalSteps) {
        throw new RunLimitReached(`Run exceeded the total step limit (${deps.limits.maxTotalSteps}).`)
      }

      const response = await provider.chat(
        {
          apiKey,
          model: node.model,
          system: node.instructions,
          messages: [...messages],
          tools: toolSet.defs,
          temperature,
          maxTokens,
          signal: ctx.signal
        },
        (delta) => deps.emit({ type: 'node.text', runId, executionId, delta })
      )
      throwIfCancelled(ctx)

      messages.push({ role: 'assistant', parts: response.parts, raw: response.raw })
      if (response.stopReason === 'refusal') {
        throw new Error('The model refused to continue this request.')
      }

      const text = textOf(response.parts)
      const calls = toolCallsOf(response.parts)

      if (calls.length === 0) {
        deps.emit({ type: 'node.finished', runId, executionId, output: text })
        return {
          executionId,
          output: text,
          handoff: toolSet.autoHandoff ? { edge: toolSet.autoHandoff, message: text || NO_OUTPUT } : undefined
        }
      }

      const results: ToolResult[] = []
      for (const call of calls) {
        deps.emit({ type: 'node.tool.call', runId, executionId, callId: call.id, name: call.name, args: call.args })

        if (call.name === HANDOFF_TOOL && toolSet.handoffTargets) {
          const target = String(call.args['target'] ?? '')
          const edge = resolveHandoffTarget(toolSet.handoffTargets, target)
          if (!edge) {
            const content = `Unknown handoff target "${target}". Valid targets: ${[...toolSet.handoffTargets.keys()].join(', ')}.`
            deps.emit({ type: 'node.tool.result', runId, executionId, callId: call.id, content, isError: true })
            results.push({ callId: call.id, content, isError: true })
            continue
          }
          const message = String(call.args['message'] ?? '') || text || NO_OUTPUT
          deps.emit({
            type: 'node.tool.result',
            runId,
            executionId,
            callId: call.id,
            content: `Handing off to ${target}.`,
            isError: false
          })
          deps.emit({ type: 'node.finished', runId, executionId, output: text })
          return { executionId, output: text, handoff: { edge, message } }
        }

        const result = await executeToolCall(ctx, toolSet, call, executionId, depth)
        deps.emit({
          type: 'node.tool.result',
          runId,
          executionId,
          callId: call.id,
          content: result.content,
          isError: result.isError
        })
        results.push({ callId: call.id, content: result.content, isError: result.isError })
      }
      messages.push({ role: 'tool', results })
    }

    throw new RunLimitReached(`"${node.name}" exceeded its turn limit (${maxTurns}).`)
  } catch (err) {
    if (!(err instanceof RunCancelled) && !ctx.signal.aborted) {
      deps.emit({ type: 'node.error', runId, executionId, error: errorMessage(err) })
    }
    throw err
  }
}

async function executeToolCall(
  ctx: RunContext,
  toolSet: NodeToolSet,
  call: ToolCallPart,
  executionId: string,
  depth: number
): Promise<{ content: string; isError: boolean }> {
  const delegateEdge = toolSet.delegates.get(call.name)
  if (delegateEdge) {
    const task = String(call.args['task'] ?? '')
    if (!task.trim()) {
      return { content: 'The "task" argument is required and must be a non-empty string.', isError: true }
    }
    if (depth + 1 > ctx.deps.limits.maxDelegationDepth) {
      throw new RunLimitReached(`Delegation depth limit (${ctx.deps.limits.maxDelegationDepth}) reached.`)
    }
    const child = ctx.nodesById.get(delegateEdge.target)!
    ctx.deps.emit({
      type: 'edge.traversed',
      runId: ctx.runId,
      fromExecutionId: executionId,
      edgeId: delegateEdge.id,
      kind: 'delegate',
      message: task
    })
    const output = await executeFlow(ctx, child, task, executionId, depth + 1)
    return { content: output, isError: false }
  }

  const ref = toolSet.mcp.get(call.name)
  if (ref) {
    try {
      return await ctx.deps.callMcpTool(ref, call.args, ctx.signal)
    } catch (err) {
      throwIfCancelled(ctx)
      return { content: `Tool error: ${errorMessage(err)}`, isError: true }
    }
  }

  return { content: `Unknown tool "${call.name}".`, isError: true }
}
