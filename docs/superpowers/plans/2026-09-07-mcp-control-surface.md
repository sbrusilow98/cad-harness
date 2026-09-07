# MCP Control Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an outside agent drive Agent Graph over MCP: edit the graph open in the window, run it, read the transcript, and manage the MCP servers and models agents use.

**Architecture:** Two responsibilities in the Electron main process become explicit services — `DocumentService` (a mirror of the open document, written by both the renderer and MCP) and `RunService` (runs, transcripts, broadcast to every window). An MCP server built on those services is served over streamable HTTP on loopback, guarded by a bearer token, and switched on from a new Settings tab.

**Tech Stack:** Electron 44, React 19, TypeScript 5.9, `@modelcontextprotocol/sdk` 1.30 (server side), `zod` 4, Node `http`, Vitest 5.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-07-mcp-control-surface-design.md`. Read it once before starting any task.
- The package is CommonJS (no `"type": "module"`). Do not add one. Import shared code with `@shared/*`; renderer code may also use `@/*`.
- Do not add dependencies. `zod` moves from `devDependencies` to `dependencies` in Task 5 and is the only manifest change.
- The listener binds `127.0.0.1` only, default port `4820`, path `/mcp`, and is disabled by default.
- The bearer token is 32 random bytes hex-encoded, stored in the encrypted secret store under the key `remoteControlToken`. It is never written to `settings.json`.
- No tool reads, writes, or reports a provider API key. `list_mcp_servers` redacts env and header **values** and keeps their names.
- Transcript caps: at most 50 runs retained; per execution at most 100000 characters of streamed text; each tool result at most 20000 characters.
- Every commit ends with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. If git asks for an identity, pass `-c user.name="Sam Brusilow" -c user.email="sbrusilow1@gmail.com"`.
- `npm test` and `npm run typecheck` must both pass at the end of every task; tasks that touch the renderer also run `npm run build`.

## File Structure

| Path | Responsibility |
|---|---|
| `src/shared/run-transcript.ts` | Run event reducer and transcript view types, shared by the renderer store and the main run service |
| `src/shared/graph-ops.ts` | Pure graph mutations and id-or-name resolution used by the control tools |
| `src/main/run-service.ts` | Owns running runs, their transcripts, and event broadcast |
| `src/main/document-service.ts` | Main's mirror of the open document |
| `src/main/control/result.ts` | `ok` / `fail` helpers shaping tool results |
| `src/main/control/deps.ts` | The `ControlDeps` interface every tool module consumes |
| `src/main/control/tools-document.ts` | Document tools |
| `src/main/control/tools-runs.ts` | Run tools |
| `src/main/control/tools-settings.ts` | MCP server and model tools |
| `src/main/control/server.ts` | Builds the `McpServer` and registers all tool modules and resources |
| `src/main/control/http.ts` | Loopback listener, bearer auth, per-request server instances |
| `src/main/control/manager.ts` | Start/stop/restart the listener to match settings; token lifecycle |
| `src/renderer/lib/document-sync.ts` | Renderer half of the document mirror |
| `src/renderer/components/RemoteControlTab.tsx` | The Settings tab |

---

### Task 1: Move the run transcript reducer into shared code

**Files:**
- Create: `src/shared/run-transcript.ts`
- Create: `src/shared/run-transcript.test.ts`
- Modify: `src/renderer/store/run.ts`
- Delete: `src/renderer/store/run.test.ts`

**Interfaces:**
- Produces: from `@shared/run-transcript` — `NodeStatus`, `ToolCallView`, `MarkerView`, `ExecutionView`, `RunState`, `initialRunState`, `deriveNodeStatus`, `applyRunEvent`. `src/renderer/store/run.ts` keeps exporting all of them by re-export, plus `useRunStore`.

- [ ] **Step 1: Create the shared module by moving code verbatim**

Create `src/shared/run-transcript.ts` containing everything from the current `src/renderer/store/run.ts` **except** the `zustand` import, the `RunStore` interface, and the `useRunStore` call. The file therefore starts:

```ts
import type { EdgeKind } from './types'
import type { RunEvent } from './events'
```

and then contains, unchanged from `src/renderer/store/run.ts`: `NodeStatus`, `ToolCallView`, `MarkerView`, `ExecutionView`, `RunState`, `initialRunState`, `updateExecution`, `deriveNodeStatus`, and `applyRunEvent`. Copy those bodies exactly; do not retype them.

- [ ] **Step 2: Reduce the renderer store to the store itself**

Replace the whole of `src/renderer/store/run.ts` with:

```ts
import { create } from 'zustand'
import type { RunEvent } from '@shared/events'
import { applyRunEvent, initialRunState, type RunState } from '@shared/run-transcript'

export * from '@shared/run-transcript'

interface RunStore extends RunState {
  handleEvent(event: RunEvent): void
  reset(): void
}

export const useRunStore = create<RunStore>((set) => ({
  ...initialRunState,
  handleEvent(event) {
    set((state) => applyRunEvent(state, event))
  },
  reset() {
    set(initialRunState)
  }
}))
```

The `export *` keeps every existing importer working (`Canvas.tsx` imports `NodeStatus`, `RunConsole.tsx` imports `ExecutionView`).

- [ ] **Step 3: Move the reducer tests**

Run: `git mv src/renderer/store/run.test.ts src/shared/run-transcript.test.ts`

Then change its first two lines from

```ts
import { applyRunEvent, initialRunState, type RunState } from './run'
```

to

```ts
import { applyRunEvent, initialRunState, type RunState } from './run-transcript'
```

(keep the `import { describe, it, expect } from 'vitest'` line and the whole body unchanged; adjust the `@shared/events` import only if the existing file used a relative path).

- [ ] **Step 4: Verify**

Run: `npx vitest run src/shared/run-transcript.test.ts && npm run typecheck && npm test`
Expected: the moved tests pass, typecheck is clean, and the full suite is unchanged in count.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "Move the run transcript reducer into shared code

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Pure graph operations

**Files:**
- Create: `src/shared/graph-ops.ts`
- Create: `src/shared/graph-ops.test.ts`

**Interfaces:**
- Consumes: `Graph`, `AgentNode`, `GraphEdge`, `EdgeKind`, `Position`, `ProviderId`, `ToolGrant`, `DEFAULT_MODELS` from `@shared/types`; `createAgentNode`, `newId` from `@shared/graph-defaults`.
- Produces: `OpsResult<T>`, `AgentSpec`, `AgentPatch`, `resolveAgent`, `resolveEdge`, `nextPosition`, `addAgent`, `updateAgent`, `removeAgent`, `setEntry`, `setGraphName`, `connect`, `updateEdgeOp`, `disconnect`, `structuralProblem`.

- [ ] **Step 1: Write the failing test**

Create `src/shared/graph-ops.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  addAgent,
  connect,
  disconnect,
  nextPosition,
  removeAgent,
  resolveAgent,
  resolveEdge,
  setEntry,
  setGraphName,
  structuralProblem,
  updateAgent,
  updateEdgeOp
} from './graph-ops'
import { emptyGraph, createAgentNode } from './graph-defaults'
import type { Graph } from './types'

function graphWith(names: string[]): Graph {
  const g = emptyGraph('Demo')
  for (const [i, name] of names.entries()) {
    g.nodes.push(createAgentNode({ x: i * 10, y: 0 }, { id: `n${i}`, name }))
  }
  g.entryNodeId = g.nodes[0]?.id ?? null
  return g
}

describe('resolveAgent', () => {
  it('resolves by id and by unique name, case-insensitively', () => {
    const g = graphWith(['Router', 'Writer'])
    expect(resolveAgent(g, 'n1')).toEqual({ ok: true, value: g.nodes[1] })
    expect(resolveAgent(g, 'writer')).toEqual({ ok: true, value: g.nodes[1] })
    expect(resolveAgent(g, '  Writer ')).toEqual({ ok: true, value: g.nodes[1] })
  })

  it('reports an unknown agent and lists the names that exist', () => {
    const result = resolveAgent(graphWith(['Router', 'Writer']), 'Ghost')
    expect(result).toEqual({ ok: false, error: 'No agent matches "Ghost". Agents in this graph: Router, Writer.' })
  })

  it('reports an ambiguous name with the candidate ids', () => {
    const g = graphWith(['Writer', 'Writer'])
    expect(resolveAgent(g, 'Writer')).toEqual({
      ok: false,
      error: 'Two or more agents are named "Writer". Use an id instead: n0, n1.'
    })
  })
})

describe('nextPosition', () => {
  it('lays new agents out in rows of four', () => {
    expect(nextPosition(emptyGraph())).toEqual({ x: 80, y: 80 })
    expect(nextPosition(graphWith(['a', 'b', 'c', 'd']))).toEqual({ x: 80, y: 260 })
  })
})

describe('addAgent', () => {
  it('adds an agent with defaults and makes the first one the entry', () => {
    const result = addAgent(emptyGraph(), { name: 'Router' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      name: 'Router',
      provider: 'anthropic',
      model: 'claude-opus-5',
      instructions: '',
      tools: [],
      position: { x: 80, y: 80 }
    })
    expect(result.graph.entryNodeId).toBe(result.value.id)
    expect(result.graph.nodes).toHaveLength(1)
  })

  it('honours an explicit provider, model, position and entry flag', () => {
    const g = graphWith(['Router'])
    const result = addAgent(g, { name: 'Writer', provider: 'openai', position: { x: 5, y: 6 }, entry: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ provider: 'openai', model: 'gpt-5', position: { x: 5, y: 6 } })
    expect(result.graph.entryNodeId).toBe(result.value.id)
  })

  it('rejects a blank name', () => {
    expect(addAgent(emptyGraph(), { name: '  ' })).toEqual({ ok: false, error: 'An agent needs a name.' })
  })
})

describe('updateAgent', () => {
  it('applies a patch and leaves other fields alone', () => {
    const g = graphWith(['Router'])
    const result = updateAgent(g, 'Router', { instructions: 'Route the work.', maxTurns: 3 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ name: 'Router', instructions: 'Route the work.', maxTurns: 3 })
  })

  it('rejects an unknown agent', () => {
    expect(updateAgent(graphWith(['Router']), 'Ghost', { name: 'x' }).ok).toBe(false)
  })
})

describe('removeAgent', () => {
  it('removes the agent, its edges, and clears the entry when it was the entry', () => {
    const g = graphWith(['Router', 'Writer'])
    const connected = connect(g, 'Router', 'Writer', 'handoff')
    expect(connected.ok).toBe(true)
    if (!connected.ok) return
    const result = removeAgent(connected.graph, 'Router')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.nodes.map((n) => n.name)).toEqual(['Writer'])
    expect(result.graph.edges).toEqual([])
    expect(result.graph.entryNodeId).toBeNull()
    expect(result.value).toEqual({ removedAgentId: 'n0', removedEdgeIds: [connected.value.id] })
  })
})

describe('connect', () => {
  it('creates an edge with a description', () => {
    const result = connect(graphWith(['Router', 'Writer']), 'Router', 'Writer', 'delegate', 'Ask for prose')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ source: 'n0', target: 'n1', kind: 'delegate', description: 'Ask for prose' })
  })

  it('rejects a duplicate edge of the same kind', () => {
    const first = connect(graphWith(['Router', 'Writer']), 'Router', 'Writer', 'handoff')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(connect(first.graph, 'Router', 'Writer', 'handoff')).toEqual({
      ok: false,
      error: 'A handoff edge from "Router" to "Writer" already exists.'
    })
    expect(connect(first.graph, 'Router', 'Writer', 'delegate').ok).toBe(true)
  })

  it('rejects an unknown endpoint', () => {
    expect(connect(graphWith(['Router']), 'Router', 'Ghost', 'handoff').ok).toBe(false)
  })
})

describe('updateEdgeOp and disconnect', () => {
  it('changes the kind and description, then removes the edge', () => {
    const made = connect(graphWith(['Router', 'Writer']), 'Router', 'Writer', 'handoff')
    expect(made.ok).toBe(true)
    if (!made.ok) return
    const updated = updateEdgeOp(made.graph, made.value.id, { kind: 'delegate', description: 'why' })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.value).toMatchObject({ kind: 'delegate', description: 'why' })
    const removed = disconnect(updated.graph, made.value.id)
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.graph.edges).toEqual([])
  })

  it('resolves an edge by its endpoints', () => {
    const made = connect(graphWith(['Router', 'Writer']), 'Router', 'Writer', 'handoff')
    expect(made.ok).toBe(true)
    if (!made.ok) return
    expect(resolveEdge(made.graph, 'Router->Writer')).toEqual({ ok: true, value: made.value })
    expect(resolveEdge(made.graph, 'Ghost->Writer').ok).toBe(false)
  })
})

describe('setEntry and setGraphName', () => {
  it('sets the entry agent and renames the graph', () => {
    const g = graphWith(['Router', 'Writer'])
    const entry = setEntry(g, 'Writer')
    expect(entry.ok).toBe(true)
    if (!entry.ok) return
    expect(entry.graph.entryNodeId).toBe('n1')
    const named = setGraphName(entry.graph, ' Pipeline ')
    expect(named.ok).toBe(true)
    if (!named.ok) return
    expect(named.graph.name).toBe('Pipeline')
    expect(setGraphName(g, '   ').ok).toBe(false)
  })
})

describe('structuralProblem', () => {
  it('accepts a sound graph and names a dangling edge or duplicate id', () => {
    const g = graphWith(['Router', 'Writer'])
    expect(structuralProblem(g)).toBeNull()
    const dangling = { ...g, edges: [{ id: 'e1', source: 'n0', target: 'ghost', kind: 'handoff' as const }] }
    expect(structuralProblem(dangling)).toMatch(/edge/i)
    const duplicate = { ...g, nodes: [...g.nodes, g.nodes[0]] }
    expect(structuralProblem(duplicate)).toMatch(/id/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/graph-ops.test.ts`
Expected: FAIL, cannot find module `./graph-ops`.

- [ ] **Step 3: Implement**

Create `src/shared/graph-ops.ts`:

```ts
import { DEFAULT_MODELS, type AgentNode, type EdgeKind, type Graph, type GraphEdge, type Position, type ProviderId, type ToolGrant } from './types'
import { createAgentNode, newId } from './graph-defaults'

export type OpsResult<T> = { ok: true; graph: Graph; value: T } | { ok: false; error: string }
export type Lookup<T> = { ok: true; value: T } | { ok: false; error: string }

export interface AgentSpec {
  name: string
  provider?: ProviderId
  model?: string
  instructions?: string
  tools?: ToolGrant[]
  position?: Position
  entry?: boolean
  temperature?: number
  maxTokens?: number
  maxTurns?: number
}

export type AgentPatch = Partial<Omit<AgentSpec, 'entry'>>

const COLUMNS = 4
const COLUMN_WIDTH = 280
const ROW_HEIGHT = 180
const ORIGIN = 80

/** Places a new agent in a tidy grid so a caller never has to supply coordinates. */
export function nextPosition(graph: Graph): Position {
  const index = graph.nodes.length
  return { x: ORIGIN + (index % COLUMNS) * COLUMN_WIDTH, y: ORIGIN + Math.floor(index / COLUMNS) * ROW_HEIGHT }
}

function normalize(reference: string): string {
  return reference.trim().toLowerCase()
}

export function resolveAgent(graph: Graph, reference: string): Lookup<AgentNode> {
  const byId = graph.nodes.find((n) => n.id === reference.trim())
  if (byId) return { ok: true, value: byId }
  const matches = graph.nodes.filter((n) => normalize(n.name) === normalize(reference))
  if (matches.length === 1) return { ok: true, value: matches[0] }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `Two or more agents are named "${reference.trim()}". Use an id instead: ${matches.map((m) => m.id).join(', ')}.`
    }
  }
  const names = graph.nodes.map((n) => n.name).join(', ')
  return {
    ok: false,
    error: `No agent matches "${reference.trim()}". Agents in this graph: ${names || 'none'}.`
  }
}

/** Accepts an edge id or a `Source->Target` pair. */
export function resolveEdge(graph: Graph, reference: string): Lookup<GraphEdge> {
  const trimmed = reference.trim()
  const byId = graph.edges.find((e) => e.id === trimmed)
  if (byId) return { ok: true, value: byId }
  const arrow = trimmed.split('->')
  if (arrow.length === 2) {
    const from = resolveAgent(graph, arrow[0])
    if (!from.ok) return from
    const to = resolveAgent(graph, arrow[1])
    if (!to.ok) return to
    const matches = graph.edges.filter((e) => e.source === from.value.id && e.target === to.value.id)
    if (matches.length === 1) return { ok: true, value: matches[0] }
    if (matches.length > 1) {
      return {
        ok: false,
        error: `"${from.value.name}" and "${to.value.name}" are joined by more than one edge. Use an id instead: ${matches
          .map((m) => m.id)
          .join(', ')}.`
      }
    }
    return { ok: false, error: `No edge joins "${from.value.name}" to "${to.value.name}".` }
  }
  return { ok: false, error: `No edge matches "${trimmed}". Use an edge id or "Source->Target".` }
}

function withNodes(graph: Graph, nodes: AgentNode[]): Graph {
  return { ...graph, nodes }
}

export function addAgent(graph: Graph, spec: AgentSpec): OpsResult<AgentNode> {
  const name = spec.name.trim()
  if (!name) return { ok: false, error: 'An agent needs a name.' }
  const provider = spec.provider ?? 'anthropic'
  const node = createAgentNode(spec.position ?? nextPosition(graph), {
    name,
    provider,
    model: spec.model?.trim() || DEFAULT_MODELS[provider],
    instructions: spec.instructions ?? '',
    tools: spec.tools ?? []
  })
  if (spec.temperature !== undefined) node.temperature = spec.temperature
  if (spec.maxTokens !== undefined) node.maxTokens = spec.maxTokens
  if (spec.maxTurns !== undefined) node.maxTurns = spec.maxTurns
  const nodes = [...graph.nodes, node]
  const entryNodeId = spec.entry || graph.entryNodeId === null ? node.id : graph.entryNodeId
  return { ok: true, graph: { ...graph, nodes, entryNodeId }, value: node }
}

export function updateAgent(graph: Graph, reference: string, patch: AgentPatch): OpsResult<AgentNode> {
  const found = resolveAgent(graph, reference)
  if (!found.ok) return found
  if (patch.name !== undefined && !patch.name.trim()) return { ok: false, error: 'An agent needs a name.' }
  const updated: AgentNode = { ...found.value }
  if (patch.name !== undefined) updated.name = patch.name.trim()
  if (patch.provider !== undefined) updated.provider = patch.provider
  if (patch.model !== undefined) updated.model = patch.model.trim()
  if (patch.instructions !== undefined) updated.instructions = patch.instructions
  if (patch.tools !== undefined) updated.tools = patch.tools
  if (patch.position !== undefined) updated.position = patch.position
  if (patch.temperature !== undefined) updated.temperature = patch.temperature
  if (patch.maxTokens !== undefined) updated.maxTokens = patch.maxTokens
  if (patch.maxTurns !== undefined) updated.maxTurns = patch.maxTurns
  const nodes = graph.nodes.map((n) => (n.id === updated.id ? updated : n))
  return { ok: true, graph: withNodes(graph, nodes), value: updated }
}

export function removeAgent(graph: Graph, reference: string): OpsResult<{ removedAgentId: string; removedEdgeIds: string[] }> {
  const found = resolveAgent(graph, reference)
  if (!found.ok) return found
  const id = found.value.id
  const removedEdgeIds = graph.edges.filter((e) => e.source === id || e.target === id).map((e) => e.id)
  const next: Graph = {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== id),
    edges: graph.edges.filter((e) => !removedEdgeIds.includes(e.id)),
    entryNodeId: graph.entryNodeId === id ? null : graph.entryNodeId
  }
  return { ok: true, graph: next, value: { removedAgentId: id, removedEdgeIds } }
}

export function setEntry(graph: Graph, reference: string): OpsResult<AgentNode> {
  const found = resolveAgent(graph, reference)
  if (!found.ok) return found
  return { ok: true, graph: { ...graph, entryNodeId: found.value.id }, value: found.value }
}

export function setGraphName(graph: Graph, name: string): OpsResult<string> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: 'A graph needs a name.' }
  return { ok: true, graph: { ...graph, name: trimmed }, value: trimmed }
}

export function connect(
  graph: Graph,
  from: string,
  to: string,
  kind: EdgeKind,
  description?: string
): OpsResult<GraphEdge> {
  const source = resolveAgent(graph, from)
  if (!source.ok) return source
  const target = resolveAgent(graph, to)
  if (!target.ok) return target
  const duplicate = graph.edges.some((e) => e.source === source.value.id && e.target === target.value.id && e.kind === kind)
  if (duplicate) {
    return { ok: false, error: `A ${kind} edge from "${source.value.name}" to "${target.value.name}" already exists.` }
  }
  const edge: GraphEdge = { id: newId(), source: source.value.id, target: target.value.id, kind }
  if (description?.trim()) edge.description = description.trim()
  return { ok: true, graph: { ...graph, edges: [...graph.edges, edge] }, value: edge }
}

export function updateEdgeOp(
  graph: Graph,
  reference: string,
  patch: { kind?: EdgeKind; description?: string }
): OpsResult<GraphEdge> {
  const found = resolveEdge(graph, reference)
  if (!found.ok) return found
  const updated: GraphEdge = { ...found.value }
  if (patch.kind !== undefined) updated.kind = patch.kind
  if (patch.description !== undefined) {
    const trimmed = patch.description.trim()
    if (trimmed) updated.description = trimmed
    else delete updated.description
  }
  const clash = graph.edges.some(
    (e) => e.id !== updated.id && e.source === updated.source && e.target === updated.target && e.kind === updated.kind
  )
  if (clash) return { ok: false, error: `A ${updated.kind} edge already joins those two agents.` }
  return { ok: true, graph: { ...graph, edges: graph.edges.map((e) => (e.id === updated.id ? updated : e)) }, value: updated }
}

export function disconnect(graph: Graph, reference: string): OpsResult<{ removedEdgeId: string }> {
  const found = resolveEdge(graph, reference)
  if (!found.ok) return found
  return {
    ok: true,
    graph: { ...graph, edges: graph.edges.filter((e) => e.id !== found.value.id) },
    value: { removedEdgeId: found.value.id }
  }
}

/** Cheap invariant check used as a guard before a mutation is published. */
export function structuralProblem(graph: Graph): string | null {
  const ids = new Set<string>()
  for (const node of graph.nodes) {
    if (ids.has(node.id)) return `Two agents share the id "${node.id}".`
    ids.add(node.id)
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return `Edge "${edge.id}" points at an agent that does not exist.`
  }
  if (graph.entryNodeId !== null && !ids.has(graph.entryNodeId)) return 'The entry agent does not exist.'
  return null
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/shared/graph-ops.test.ts && npm run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/graph-ops.ts src/shared/graph-ops.test.ts
git commit -m "Add pure graph operations for the control surface

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Run service

**Files:**
- Create: `src/main/run-service.ts`
- Create: `src/main/run-service.test.ts`

**Interfaces:**
- Consumes: `applyRunEvent`, `initialRunState`, `RunState`, `ExecutionView` from `@shared/run-transcript`; `RunEvent` from `@shared/events`; `Graph` from `@shared/types`.
- Produces: `RunRecord`, `RunSummary`, `RunServiceDeps`, `class RunService` with `start(graph, input): string`, `stop(runId): boolean`, `get(runId): RunRecord | undefined`, `list(limit?): RunSummary[]`, `wait(runId, timeoutMs): Promise<RunRecord | undefined>`, `stopAll(): void`, and the exported constants `MAX_RUNS`, `MAX_EXECUTION_TEXT`, `MAX_TOOL_RESULT`.

`wait` resolves with the record whether or not the run finished: a record still `running` means the wait timed out and the caller should poll `get`.

- [ ] **Step 1: Write the failing test**

Create `src/main/run-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { RunService, MAX_EXECUTION_TEXT, MAX_TOOL_RESULT, type RunServiceDeps } from './run-service'
import type { RunEvent } from '@shared/events'
import { emptyGraph, createAgentNode } from '@shared/graph-defaults'
import type { Graph } from '@shared/types'

function graph(): Graph {
  const g = emptyGraph('Demo')
  g.nodes.push(createAgentNode({ x: 0, y: 0 }, { id: 'a', name: 'A' }))
  g.entryNodeId = 'a'
  return g
}

interface Harness {
  service: RunService
  broadcast: RunEvent[]
  emitters: ((event: RunEvent) => void)[]
  settle: (() => void)[]
  signals: AbortSignal[]
}

/** Drives the service with a fake engine whose completion we control. */
function harness(): Harness {
  const broadcast: RunEvent[] = []
  const emitters: ((event: RunEvent) => void)[] = []
  const settle: (() => void)[] = []
  const signals: AbortSignal[] = []
  const deps: RunServiceDeps = {
    broadcast: (event) => broadcast.push(event),
    startRun: ({ emit, signal }) => {
      emitters.push(emit)
      signals.push(signal)
      return new Promise<void>((resolve) => settle.push(resolve))
    }
  }
  return { service: new RunService(deps), broadcast, emitters, settle, signals }
}

describe('RunService', () => {
  it('records a run, broadcasts its events, and exposes the transcript', async () => {
    const h = harness()
    const runId = h.service.start(graph(), 'do it')
    const emit = h.emitters[0]
    emit({ type: 'run.started', runId })
    emit({ type: 'node.started', runId, executionId: 'x1', nodeId: 'a', parentExecutionId: null, input: 'do it', depth: 0 })
    emit({ type: 'node.text', runId, executionId: 'x1', delta: 'Hello' })
    emit({ type: 'node.finished', runId, executionId: 'x1', output: 'Hello' })
    emit({ type: 'run.finished', runId, output: 'Hello' })
    h.settle[0]()
    await h.service.wait(runId, 1000)

    const record = h.service.get(runId)
    expect(record).toMatchObject({ id: runId, status: 'finished', input: 'do it', output: 'Hello' })
    expect(record?.executions).toHaveLength(1)
    expect(record?.executions[0]).toMatchObject({ nodeId: 'a', text: 'Hello', status: 'done' })
    expect(record?.finishedAt).not.toBeNull()
    expect(h.broadcast.map((e) => e.type)).toEqual(['run.started', 'node.started', 'node.text', 'node.finished', 'run.finished'])
  })

  it('waits for a run and resolves as soon as it finishes', async () => {
    const h = harness()
    const runId = h.service.start(graph(), 'x')
    const pending = h.service.wait(runId, 2000)
    h.emitters[0]({ type: 'run.started', runId })
    h.emitters[0]({ type: 'run.finished', runId, output: 'done' })
    h.settle[0]()
    await expect(pending).resolves.toMatchObject({ status: 'finished', output: 'done' })
  })

  it('resolves a still-running record when the wait times out', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      const runId = h.service.start(graph(), 'x')
      h.emitters[0]({ type: 'run.started', runId })
      const pending = h.service.wait(runId, 50)
      await vi.advanceTimersByTimeAsync(60)
      await expect(pending).resolves.toMatchObject({ status: 'running' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops a run through its abort signal and reports an unknown id', () => {
    const h = harness()
    const runId = h.service.start(graph(), 'x')
    expect(h.service.stop(runId)).toBe(true)
    expect(h.signals[0].aborted).toBe(true)
    expect(h.service.stop('nope')).toBe(false)
  })

  it('marks a run errored when the engine rejects', async () => {
    const broadcast: RunEvent[] = []
    const deps: RunServiceDeps = {
      broadcast: (event) => broadcast.push(event),
      startRun: () => Promise.reject(new Error('engine exploded'))
    }
    const service = new RunService(deps)
    const runId = service.start(graph(), 'x')
    const record = await service.wait(runId, 1000)
    expect(record).toMatchObject({ status: 'error', error: 'engine exploded' })
  })

  it('truncates long streamed text and long tool results', async () => {
    const h = harness()
    const runId = h.service.start(graph(), 'x')
    const emit = h.emitters[0]
    emit({ type: 'run.started', runId })
    emit({ type: 'node.started', runId, executionId: 'x1', nodeId: 'a', parentExecutionId: null, input: '', depth: 0 })
    emit({ type: 'node.text', runId, executionId: 'x1', delta: 'a'.repeat(MAX_EXECUTION_TEXT + 500) })
    emit({ type: 'node.text', runId, executionId: 'x1', delta: 'ignored' })
    emit({ type: 'node.tool.call', runId, executionId: 'x1', callId: 'c1', name: 't', args: {} })
    emit({ type: 'node.tool.result', runId, executionId: 'x1', callId: 'c1', content: 'b'.repeat(MAX_TOOL_RESULT + 500), isError: false })

    const record = h.service.get(runId)!
    const execution = record.executions[0]
    expect(execution.text.length).toBeLessThanOrEqual(MAX_EXECUTION_TEXT + 40)
    expect(execution.text.endsWith('[truncated]')).toBe(true)
    expect(execution.text).not.toContain('ignored')
    expect(execution.toolCalls[0].result?.endsWith('[truncated]')).toBe(true)
  })

  it('keeps only the most recent runs and lists them newest first', () => {
    const h = harness()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push(h.service.start(graph(), `run ${i}`))
    expect(h.service.list().map((r) => r.input)).toEqual(['run 2', 'run 1', 'run 0'])
    expect(h.service.list(2)).toHaveLength(2)
    expect(h.service.get(ids[0])).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/run-service.test.ts`
Expected: FAIL, cannot find module `./run-service`.

- [ ] **Step 3: Implement**

Create `src/main/run-service.ts`:

```ts
import type { RunEvent } from '@shared/events'
import type { Graph } from '@shared/types'
import { applyRunEvent, initialRunState, type ExecutionView, type RunState } from '@shared/run-transcript'
import { errorMessage } from '@shared/errors'

export const MAX_RUNS = 50
export const MAX_EXECUTION_TEXT = 100_000
export const MAX_TOOL_RESULT = 20_000

export type RunStatus = 'running' | 'finished' | 'error' | 'cancelled'

export interface RunRecord {
  id: string
  status: RunStatus
  input: string
  output: string | null
  error: string | null
  warnings: string[]
  startedAt: string
  finishedAt: string | null
  executions: ExecutionView[]
}

export type RunSummary = Omit<RunRecord, 'executions'>

export interface StartRunOptions {
  runId: string
  graph: Graph
  input: string
  signal: AbortSignal
  emit: (event: RunEvent) => void
}

export interface RunServiceDeps {
  /** Runs the graph. Resolves when the run is over; the service never expects it to throw for a run error. */
  startRun(options: StartRunOptions): Promise<void>
  /** Sends an event to every interested window. */
  broadcast(event: RunEvent): void
}

interface Entry {
  id: string
  input: string
  startedAt: string
  finishedAt: string | null
  controller: AbortController
  state: RunState
  waiters: (() => void)[]
}

function toRecord(entry: Entry): RunRecord {
  const status: RunStatus = entry.state.status === 'idle' ? 'running' : entry.state.status
  return {
    id: entry.id,
    status,
    input: entry.input,
    output: entry.state.output,
    error: entry.state.error,
    warnings: entry.state.warnings,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    executions: entry.state.executions
  }
}

export class RunService {
  private entries = new Map<string, Entry>()

  constructor(private readonly deps: RunServiceDeps) {}

  start(graph: Graph, input: string): string {
    const runId = globalThis.crypto.randomUUID()
    const entry: Entry = {
      id: runId,
      input,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      controller: new AbortController(),
      state: { ...initialRunState, runId, status: 'running' },
      waiters: []
    }
    this.entries.set(runId, entry)
    this.evict()

    const emit = (event: RunEvent): void => {
      this.record(entry, event)
      this.deps.broadcast(event)
    }

    void this.deps
      .startRun({ runId, graph, input, signal: entry.controller.signal, emit })
      .catch((err: unknown) => {
        // The engine reports its own failures as events; this is the last resort.
        if (entry.state.status === 'running') {
          entry.state = { ...entry.state, status: 'error', error: errorMessage(err) }
        }
      })
      .finally(() => {
        if (entry.finishedAt === null) entry.finishedAt = new Date().toISOString()
        for (const waiter of entry.waiters.splice(0)) waiter()
      })

    return runId
  }

  stop(runId: string): boolean {
    const entry = this.entries.get(runId)
    if (!entry) return false
    entry.controller.abort()
    return true
  }

  stopAll(): void {
    for (const entry of this.entries.values()) entry.controller.abort()
  }

  get(runId: string): RunRecord | undefined {
    const entry = this.entries.get(runId)
    return entry ? toRecord(entry) : undefined
  }

  list(limit = MAX_RUNS): RunSummary[] {
    const records = [...this.entries.values()].reverse().slice(0, Math.max(0, limit))
    return records.map((entry) => {
      const { executions: _executions, ...summary } = toRecord(entry)
      return summary
    })
  }

  /** Resolves once the run is over, or with the still-running record when the timeout elapses. */
  wait(runId: string, timeoutMs: number): Promise<RunRecord | undefined> {
    const entry = this.entries.get(runId)
    if (!entry) return Promise.resolve(undefined)
    if (entry.finishedAt !== null) return Promise.resolve(toRecord(entry))
    return new Promise<RunRecord | undefined>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(this.get(runId))
      }
      const timer = setTimeout(finish, timeoutMs)
      entry.waiters.push(finish)
    })
  }

  private record(entry: Entry, event: RunEvent): void {
    entry.state = applyRunEvent(entry.state, this.cap(entry, event))
    if (event.type === 'run.finished' || event.type === 'run.error' || event.type === 'run.cancelled') {
      if (entry.finishedAt === null) entry.finishedAt = new Date().toISOString()
    }
  }

  /** Keeps a long-running or noisy run from growing without bound. */
  private cap(entry: Entry, event: RunEvent): RunEvent {
    if (event.type === 'node.text') {
      const execution = entry.state.executions.find((e) => e.executionId === event.executionId)
      const length = execution?.text.length ?? 0
      if (length >= MAX_EXECUTION_TEXT) return { ...event, delta: '' }
      if (length + event.delta.length > MAX_EXECUTION_TEXT) {
        return { ...event, delta: `${event.delta.slice(0, MAX_EXECUTION_TEXT - length)}\n[truncated]` }
      }
      return event
    }
    if (event.type === 'node.tool.result' && event.content.length > MAX_TOOL_RESULT) {
      return { ...event, content: `${event.content.slice(0, MAX_TOOL_RESULT)}\n[truncated]` }
    }
    return event
  }

  private evict(): void {
    while (this.entries.size > MAX_RUNS) {
      const oldest = this.entries.keys().next()
      if (oldest.done) return
      this.entries.delete(oldest.value)
    }
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/main/run-service.test.ts && npm run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/run-service.ts src/main/run-service.test.ts
git commit -m "Add a run service that owns runs, transcripts, and broadcast

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Document service

**Files:**
- Create: `src/main/document-service.ts`
- Create: `src/main/document-service.test.ts`

**Interfaces:**
- Consumes: `Graph` from `@shared/types`; `emptyGraph` from `@shared/graph-defaults`; `OpsResult`, `structuralProblem` from `@shared/graph-ops`.
- Produces: `OpenDocument` (`{ graph, path, dirty, revision }`), `DocumentService` with `get()`, `syncFromRenderer(input)`, `replace(graph, path, dirty)`, `mutate(fn)`.

`mutate` returns `{ ok: true; value: T; document: OpenDocument }` or `{ ok: false; error: string }`, and pushes only on success. `syncFromRenderer` never pushes, which is what stops an edit made in the window from echoing back to it.

- [ ] **Step 1: Write the failing test**

Create `src/main/document-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { DocumentService, type OpenDocument } from './document-service'
import { emptyGraph, createAgentNode } from '@shared/graph-defaults'
import { addAgent, setGraphName } from '@shared/graph-ops'
import type { Graph } from '@shared/types'

function graphWithOne(): Graph {
  const g = emptyGraph('Demo')
  g.nodes.push(createAgentNode({ x: 0, y: 0 }, { id: 'a', name: 'A' }))
  g.entryNodeId = 'a'
  return g
}

function make(): { service: DocumentService; pushed: OpenDocument[] } {
  const pushed: OpenDocument[] = []
  return { service: new DocumentService((doc) => pushed.push(doc)), pushed }
}

describe('DocumentService', () => {
  it('starts with an empty untitled document', () => {
    const { service } = make()
    expect(service.get()).toEqual({ graph: emptyGraph(), path: null, dirty: false, revision: 0 })
  })

  it('takes the renderer as the source of truth without pushing back', () => {
    const { service, pushed } = make()
    service.syncFromRenderer({ graph: graphWithOne(), path: '/tmp/a.json', dirty: true })
    expect(service.get()).toMatchObject({ path: '/tmp/a.json', dirty: true, revision: 1 })
    expect(service.get().graph.nodes).toHaveLength(1)
    expect(pushed).toEqual([])
  })

  it('applies a mutation, marks the document dirty, and pushes it', () => {
    const { service, pushed } = make()
    const result = service.mutate((graph) => addAgent(graph, { name: 'Router' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.name).toBe('Router')
    expect(service.get().dirty).toBe(true)
    expect(service.get().revision).toBe(1)
    expect(pushed).toHaveLength(1)
    expect(pushed[0].graph.nodes).toHaveLength(1)
  })

  it('leaves the document untouched when the operation fails', () => {
    const { service, pushed } = make()
    const before = service.get()
    const result = service.mutate((graph) => setGraphName(graph, '   '))
    expect(result).toEqual({ ok: false, error: 'A graph needs a name.' })
    expect(service.get()).toEqual(before)
    expect(pushed).toEqual([])
  })

  it('refuses a mutation that would break the graph', () => {
    const { service, pushed } = make()
    const result = service.mutate((graph) => ({
      ok: true,
      graph: { ...graph, edges: [{ id: 'e1', source: 'ghost', target: 'ghost', kind: 'handoff' as const }] },
      value: 'x'
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/does not exist/)
    expect(pushed).toEqual([])
  })

  it('replaces the document for a new or opened file and pushes it', () => {
    const { service, pushed } = make()
    const replaced = service.replace(graphWithOne(), '/tmp/b.json', false)
    expect(replaced).toMatchObject({ path: '/tmp/b.json', dirty: false, revision: 1 })
    expect(pushed).toHaveLength(1)
    expect(pushed[0].path).toBe('/tmp/b.json')
  })

  it('survives a push target that throws', () => {
    const service = new DocumentService(() => {
      throw new Error('no window')
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(service.mutate((graph) => addAgent(graph, { name: 'Router' })).ok).toBe(true)
    expect(service.get().graph.nodes).toHaveLength(1)
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/document-service.test.ts`
Expected: FAIL, cannot find module `./document-service`.

- [ ] **Step 3: Implement**

Create `src/main/document-service.ts`:

```ts
import type { Graph } from '@shared/types'
import { emptyGraph } from '@shared/graph-defaults'
import { structuralProblem, type OpsResult } from '@shared/graph-ops'
import { errorMessage } from '@shared/errors'

export interface OpenDocument {
  graph: Graph
  path: string | null
  dirty: boolean
  /** Bumped on every change so a listener can tell one state from another. */
  revision: number
}

export type MutationResult<T> = { ok: true; value: T; document: OpenDocument } | { ok: false; error: string }

/**
 * Main's mirror of the document open in the window. The renderer stays where a human edits and
 * reports its changes here; the control surface reads and writes through `mutate`, which pushes the
 * result back to the window. Renderer syncs never push, so a local edit cannot echo.
 */
export class DocumentService {
  private document: OpenDocument = { graph: emptyGraph(), path: null, dirty: false, revision: 0 }

  constructor(private readonly push: (document: OpenDocument) => void) {}

  get(): OpenDocument {
    return this.document
  }

  syncFromRenderer(input: { graph: Graph; path: string | null; dirty: boolean }): void {
    this.document = { ...input, revision: this.document.revision + 1 }
  }

  replace(graph: Graph, path: string | null, dirty: boolean): OpenDocument {
    this.document = { graph, path, dirty, revision: this.document.revision + 1 }
    this.publish()
    return this.document
  }

  mutate<T>(fn: (graph: Graph) => OpsResult<T>): MutationResult<T> {
    const result = fn(this.document.graph)
    if (!result.ok) return result
    const problem = structuralProblem(result.graph)
    if (problem) return { ok: false, error: problem }
    this.document = { graph: result.graph, path: this.document.path, dirty: true, revision: this.document.revision + 1 }
    this.publish()
    return { ok: true, value: result.value, document: this.document }
  }

  private publish(): void {
    try {
      this.push(this.document)
    } catch (err) {
      // A closed or reloading window must not fail the mutation that reached it.
      console.error('Could not push the document to the window:', errorMessage(err))
    }
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/main/document-service.test.ts && npm run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/document-service.ts src/main/document-service.test.ts
git commit -m "Add the mirrored open document service

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Control server with the document tools

**Files:**
- Create: `src/main/control/deps.ts`
- Create: `src/main/control/result.ts`
- Create: `src/main/control/tools-document.ts`
- Create: `src/main/control/server.ts`
- Create: `src/main/control/test-harness.ts`
- Create: `src/main/control/tools-document.test.ts`
- Modify: `package.json` (move `zod` from `devDependencies` to `dependencies`)

**Interfaces:**
- Consumes: `DocumentService` from `../document-service`; `RunService` from `../run-service`; graph ops from `@shared/graph-ops`; `validateGraph` from `../runtime/validate`; `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`.
- Produces: `ControlDeps`; `ok(payload)` and `fail(message)` from `./result`; `describeDocument(document)` and `registerDocumentTools(server, deps)` from `./tools-document`; `buildControlServer(deps): McpServer` from `./server`.

- [ ] **Step 1: Move zod to runtime dependencies**

In `package.json`, delete the `"zod": "4.5.4",` line from `devDependencies` and add `"zod": "4.5.4"` to `dependencies`, keeping both blocks alphabetically ordered. Then run `npm install --no-audit --no-fund` so the lockfile records the move.

Run: `node -e "const p=require('./package.json');console.log(p.dependencies.zod, p.devDependencies.zod)"`
Expected: `4.5.4 undefined`

- [ ] **Step 2: Write the failing test**

First create the shared harness, `src/main/control/test-harness.ts`. It is a plain module, not a
`.test.ts` file, so importing it from several test files does not re-register anyone's tests:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildControlServer } from './server'
import type { ControlDeps } from './deps'
import { DocumentService } from '../document-service'
import { RunService } from '../run-service'
import { DEFAULT_SETTINGS, type Graph, type Settings } from '@shared/types'

export interface Harness {
  client: Client
  deps: ControlDeps
  files: Map<string, Graph>
  call: (name: string, args?: Record<string, unknown>) => Promise<{ isError: boolean; text: string; payload: any }>
}

/** Wires a real MCP client to the control server over the SDK's in-memory transport. */
export async function harness(overrides: Partial<ControlDeps> = {}): Promise<Harness> {
  const files = new Map<string, Graph>()
  let settings: Settings = { ...DEFAULT_SETTINGS }
  const deps: ControlDeps = {
    document: new DocumentService(() => undefined),
    runs: new RunService({ startRun: () => new Promise(() => undefined), broadcast: () => undefined }),
    settings: {
      get: () => settings,
      update: (patch) => {
        settings = { ...settings, ...patch }
        return settings
      }
    },
    mcp: { test: async () => [], invalidate: async () => undefined },
    listModels: async () => ({ models: ['claude-opus-5'], source: 'fallback' }),
    readGraphFile: async (path) => {
      const graph = files.get(path)
      if (!graph) throw new Error(`no such file: ${path}`)
      return graph
    },
    writeGraphFile: async (path, graph) => {
      files.set(path, graph)
    },
    ...overrides
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = buildControlServer(deps)
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args })
    const content = (result.content as { type: string; text: string }[])[0]
    const text = content?.text ?? ''
    let payload: any = null
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
    return { isError: result.isError === true, text, payload }
  }

  return { client, deps, files, call }
}
```

Then create `src/main/control/tools-document.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { emptyGraph } from '@shared/graph-defaults'
import { harness, type Harness } from './test-harness'

describe('document tools', () => {
  let h: Harness

  beforeEach(async () => {
    h = await harness()
  })

  it('lists every document tool', async () => {
    const { tools } = await h.client.listTools()
    const names = tools.map((t) => t.name)
    for (const name of [
      'get_graph',
      'new_graph',
      'open_graph',
      'save_graph',
      'set_graph_name',
      'add_agent',
      'update_agent',
      'remove_agent',
      'set_entry',
      'connect',
      'update_edge',
      'disconnect',
      'validate_graph'
    ]) {
      expect(names).toContain(name)
    }
  })

  it('describes an empty document', async () => {
    const result = await h.call('get_graph')
    expect(result.isError).toBe(false)
    expect(result.payload).toMatchObject({ name: 'Untitled', path: null, dirty: false, entryAgentId: null, agents: [], edges: [] })
  })

  it('adds agents, makes the first one the entry, and connects them by name', async () => {
    const router = await h.call('add_agent', { name: 'Router', instructions: 'Route it.' })
    expect(router.isError).toBe(false)
    expect(router.payload).toMatchObject({ name: 'Router', provider: 'anthropic', instructions: 'Route it.' })

    await h.call('add_agent', { name: 'Writer', provider: 'openai' })
    const edge = await h.call('connect', { from: 'Router', to: 'Writer', kind: 'handoff', description: 'For prose' })
    expect(edge.isError).toBe(false)
    expect(edge.payload).toMatchObject({ from: 'Router', to: 'Writer', kind: 'handoff', description: 'For prose' })

    const graph = await h.call('get_graph')
    expect(graph.payload.agents).toHaveLength(2)
    expect(graph.payload.entryAgentId).toBe(router.payload.id)
    expect(graph.payload.dirty).toBe(true)
  })

  it('updates an agent, moves the entry, and renames the graph', async () => {
    await h.call('add_agent', { name: 'Router' })
    await h.call('add_agent', { name: 'Writer' })
    const updated = await h.call('update_agent', { agent: 'Writer', model: 'claude-sonnet-5', maxTurns: 4 })
    expect(updated.payload).toMatchObject({ name: 'Writer', model: 'claude-sonnet-5', maxTurns: 4 })
    await h.call('set_entry', { agent: 'Writer' })
    await h.call('set_graph_name', { name: 'Pipeline' })
    const graph = await h.call('get_graph')
    expect(graph.payload.name).toBe('Pipeline')
    expect(graph.payload.entryAgentId).toBe(updated.payload.id)
  })

  it('removes an agent together with its edges, and disconnects an edge on its own', async () => {
    await h.call('add_agent', { name: 'Router' })
    await h.call('add_agent', { name: 'Writer' })
    const edge = await h.call('connect', { from: 'Router', to: 'Writer', kind: 'delegate' })
    const changed = await h.call('update_edge', { edge: edge.payload.id, kind: 'handoff' })
    expect(changed.payload.kind).toBe('handoff')

    const disconnected = await h.call('disconnect', { edge: 'Router->Writer' })
    expect(disconnected.isError).toBe(false)
    expect((await h.call('get_graph')).payload.edges).toEqual([])

    await h.call('connect', { from: 'Router', to: 'Writer', kind: 'handoff' })
    const removed = await h.call('remove_agent', { agent: 'Router' })
    expect(removed.payload.removedEdgeIds).toHaveLength(1)
    const graph = await h.call('get_graph')
    expect(graph.payload.agents).toHaveLength(1)
    expect(graph.payload.entryAgentId).toBeNull()
  })

  it('reports unknown and ambiguous references as tool errors', async () => {
    await h.call('add_agent', { name: 'Router' })
    const missing = await h.call('update_agent', { agent: 'Ghost', model: 'x' })
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain('No agent matches "Ghost"')

    await h.call('add_agent', { name: 'Twin' })
    await h.call('add_agent', { name: 'Twin' })
    const ambiguous = await h.call('set_entry', { agent: 'Twin' })
    expect(ambiguous.isError).toBe(true)
    expect(ambiguous.text).toContain('Use an id instead')
  })

  it('refuses a duplicate edge', async () => {
    await h.call('add_agent', { name: 'Router' })
    await h.call('add_agent', { name: 'Writer' })
    await h.call('connect', { from: 'Router', to: 'Writer', kind: 'handoff' })
    const again = await h.call('connect', { from: 'Router', to: 'Writer', kind: 'handoff' })
    expect(again.isError).toBe(true)
    expect(again.text).toContain('already exists')
  })

  it('opens, saves, and starts a new graph', async () => {
    const stored = emptyGraph('From disk')
    h.files.set('/tmp/stored.json', stored)

    const opened = await h.call('open_graph', { path: '/tmp/stored.json' })
    expect(opened.payload).toMatchObject({ name: 'From disk', path: '/tmp/stored.json', dirty: false })

    await h.call('add_agent', { name: 'Router' })
    const saved = await h.call('save_graph')
    expect(saved.payload).toEqual({ path: '/tmp/stored.json', saved: true })
    expect(h.files.get('/tmp/stored.json')?.nodes).toHaveLength(1)
    expect((await h.call('get_graph')).payload.dirty).toBe(false)

    const fresh = await h.call('new_graph', { name: 'Blank' })
    expect(fresh.payload).toMatchObject({ name: 'Blank', path: null, agents: [] })
    const noPath = await h.call('save_graph')
    expect(noPath.isError).toBe(true)
    expect(noPath.text).toContain('path')
  })

  it('reports a missing file as a tool error', async () => {
    const result = await h.call('open_graph', { path: '/tmp/nope.json' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('no such file')
  })

  it('validates the graph', async () => {
    const empty = await h.call('validate_graph')
    expect(empty.payload.ok).toBe(false)
    expect(JSON.stringify(empty.payload.issues)).toContain('entry')

    await h.call('add_agent', { name: 'Router' })
    const valid = await h.call('validate_graph')
    expect(valid.payload.ok).toBe(true)
  })

  it('serves the document as a resource', async () => {
    await h.call('add_agent', { name: 'Router' })
    const result = await h.client.readResource({ uri: 'agentgraph://document' })
    expect(JSON.parse(result.contents[0].text as string).agents).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/control/tools-document.test.ts`
Expected: FAIL, cannot find module `./server`.

- [ ] **Step 4: Write the dependency interface**

Create `src/main/control/deps.ts`:

```ts
import type { Graph, McpServerConfig, ProviderId, Settings } from '@shared/types'
import type { ModelListResult } from '@shared/ipc'
import type { DocumentService } from '../document-service'
import type { RunService } from '../run-service'
import type { McpToolInfo } from '../runtime/graph-tools'

/**
 * Everything the control tools need, as an interface so they can be tested without Electron.
 * Nothing here can read or write a provider API key.
 */
export interface ControlDeps {
  document: DocumentService
  runs: RunService
  settings: {
    get(): Settings
    update(patch: Partial<Settings>): Settings
  }
  mcp: {
    test(config: McpServerConfig): Promise<McpToolInfo[]>
    invalidate(serverId: string): Promise<void>
  }
  listModels(provider: ProviderId): Promise<ModelListResult>
  readGraphFile(path: string): Promise<Graph>
  writeGraphFile(path: string, graph: Graph): Promise<void>
}
```

- [ ] **Step 5: Write the result helpers**

Create `src/main/control/result.ts`:

```ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/** Every tool answers with pretty JSON so an agent can read it without guessing. */
export function ok(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

export function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
```

- [ ] **Step 6: Write the document tools**

Create `src/main/control/tools-document.ts`:

```ts
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
    { description: 'Open a graph file from disk and show it in the app.', inputSchema: { path: z.string() } },
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
      const document = deps.document.get()
      const target = path?.trim() || document.path
      if (!target) return fail('This graph has no path yet. Call save_graph again with a path.')
      try {
        await deps.writeGraphFile(target, document.graph)
        deps.document.replace(document.graph, target, false)
        return ok({ path: target, saved: true })
      } catch (err) {
        return fail(errorMessage(err))
      }
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
      description: 'Change an agent. Give it by id or by name. Only the fields you pass are changed.',
      inputSchema: {
        agent: z.string(),
        name: z.string().optional(),
        provider: provider.optional(),
        model: z.string().optional(),
        instructions: z.string().optional(),
        tools: z.array(toolGrant).optional(),
        position: position.optional(),
        temperature: z.number().optional(),
        maxTokens: z.number().optional(),
        maxTurns: z.number().optional()
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
```

- [ ] **Step 7: Write the server builder**

Create `src/main/control/server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ControlDeps } from './deps'
import { describeDocument, registerDocumentTools } from './tools-document'

export const CONTROL_SERVER_INFO = { name: 'agent-graph', version: '0.1.0' } as const

/** Builds a control server bound to one set of dependencies. Cheap: one is made per HTTP request. */
export function buildControlServer(deps: ControlDeps): McpServer {
  const server = new McpServer(CONTROL_SERVER_INFO, {
    instructions:
      'Controls the Agent Graph desktop app. Edit the graph open in the window, run it, and read the transcript. Agents and edges can be named instead of given by id.'
  })

  registerDocumentTools(server, deps)

  server.registerResource(
    'document',
    'agentgraph://document',
    { title: 'Open graph', description: 'The graph currently open in the app.', mimeType: 'application/json' },
    () => ({
      contents: [
        {
          uri: 'agentgraph://document',
          mimeType: 'application/json',
          text: JSON.stringify(describeDocument(deps.document.get()), null, 2)
        }
      ]
    })
  )

  return server
}
```

- [ ] **Step 8: Run tests and typecheck**

Run: `npx vitest run src/main/control/tools-document.test.ts && npm run typecheck`
Expected: all pass; typecheck clean. If `registerTool`'s callback argument types come through as `unknown`, annotate the destructured parameter rather than casting the schema.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/main/control
git commit -m "Add the MCP control server with document tools

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Run tools

**Files:**
- Create: `src/main/control/tools-runs.ts`
- Create: `src/main/control/tools-runs.test.ts`
- Modify: `src/main/control/server.ts`

**Interfaces:**
- Consumes: `ControlDeps`, `ok`, `fail`, `RunService`, `validateGraph`, `hasErrors` from `../runtime/validate`.
- Produces: `registerRunTools(server, deps)`; the `agentgraph://runs/{runId}` resource is registered in `server.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/main/control/tools-runs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { harness } from './test-harness'
import { RunService } from '../run-service'
import type { RunEvent } from '@shared/events'

/** A run service whose fake engine finishes immediately with a scripted transcript. */
function scriptedRuns(): RunService {
  return new RunService({
    broadcast: () => undefined,
    startRun: async ({ runId, emit, input }) => {
      emit({ type: 'run.started', runId })
      emit({ type: 'node.started', runId, executionId: 'x1', nodeId: 'a', parentExecutionId: null, input, depth: 0 })
      emit({ type: 'node.text', runId, executionId: 'x1', delta: 'Answer' })
      emit({ type: 'node.finished', runId, executionId: 'x1', output: 'Answer' })
      emit({ type: 'run.finished', runId, output: 'Answer' })
    }
  })
}

function neverEndingRuns(): RunService {
  return new RunService({
    broadcast: () => undefined,
    startRun: ({ runId, emit }) => {
      emit({ type: 'run.started', runId })
      return new Promise<void>(() => undefined)
    }
  })
}

describe('run tools', () => {
  it('refuses to run a graph with no entry agent', async () => {
    const h = await harness({ runs: scriptedRuns() })
    const result = await h.call('run_graph', { input: 'hello' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('entry')
  })

  it('runs the open graph and returns the transcript', async () => {
    const h = await harness({ runs: scriptedRuns() })
    await h.call('add_agent', { name: 'Router' })
    const result = await h.call('run_graph', { input: 'hello' })
    expect(result.isError).toBe(false)
    expect(result.payload).toMatchObject({ status: 'finished', output: 'Answer', input: 'hello' })
    expect(result.payload.executions[0]).toMatchObject({ text: 'Answer', status: 'done' })
    expect(typeof result.payload.runId).toBe('string')
  })

  it('returns immediately when asked not to wait', async () => {
    const h = await harness({ runs: neverEndingRuns() })
    await h.call('add_agent', { name: 'Router' })
    const result = await h.call('run_graph', { input: 'hello', wait: false })
    expect(result.payload).toMatchObject({ status: 'running' })
    expect(result.payload.executions).toBeUndefined()
  })

  it('reports a still-running status when the wait elapses', async () => {
    const h = await harness({ runs: neverEndingRuns() })
    await h.call('add_agent', { name: 'Router' })
    const result = await h.call('run_graph', { input: 'hello', timeoutSeconds: 0.05 })
    expect(result.payload.status).toBe('running')
    expect(result.payload.note).toContain('get_run')
  })

  it('reads a run back, lists runs, and stops one', async () => {
    const h = await harness({ runs: neverEndingRuns() })
    await h.call('add_agent', { name: 'Router' })
    const started = await h.call('run_graph', { input: 'hello', wait: false })
    const runId = started.payload.runId as string

    const fetched = await h.call('get_run', { runId })
    expect(fetched.payload).toMatchObject({ runId, status: 'running' })

    const listed = await h.call('list_runs')
    expect(listed.payload.runs).toHaveLength(1)
    expect(listed.payload.runs[0]).toMatchObject({ runId, input: 'hello' })

    const stopped = await h.call('stop_run', { runId })
    expect(stopped.payload).toMatchObject({ runId, stopped: true })

    const unknown = await h.call('get_run', { runId: 'nope' })
    expect(unknown.isError).toBe(true)
    expect(unknown.text).toContain('nope')
    expect((await h.call('stop_run', { runId: 'nope' })).isError).toBe(true)
  })

  it('serves a run as a resource', async () => {
    const h = await harness({ runs: scriptedRuns() })
    await h.call('add_agent', { name: 'Router' })
    const run = await h.call('run_graph', { input: 'hello' })
    const uri = `agentgraph://runs/${run.payload.runId}`
    const result = await h.client.readResource({ uri })
    expect(JSON.parse(result.contents[0].text as string)).toMatchObject({ status: 'finished' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/control/tools-runs.test.ts`
Expected: FAIL, `run_graph` is not a registered tool.

- [ ] **Step 3: Implement the run tools**

Create `src/main/control/tools-runs.ts`:

```ts
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { hasErrors, validateGraph } from '../runtime/validate'
import type { RunRecord } from '../run-service'
import type { ControlDeps } from './deps'
import { fail, ok } from './result'

const DEFAULT_TIMEOUT_SECONDS = 300

function describeRun(record: RunRecord): unknown {
  return {
    runId: record.id,
    status: record.status,
    input: record.input,
    output: record.output,
    error: record.error,
    warnings: record.warnings,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    executions: record.executions.map((execution) => ({
      agentId: execution.nodeId,
      depth: execution.depth,
      input: execution.input,
      text: execution.text,
      status: execution.status,
      error: execution.error,
      toolCalls: execution.toolCalls.map((call) => ({
        name: call.name,
        args: call.args,
        result: call.result,
        isError: call.isError
      })),
      handoffs: execution.markers
    }))
  }
}

export function registerRunTools(server: McpServer, deps: ControlDeps): void {
  server.registerTool(
    'run_graph',
    {
      description:
        'Run the open graph from its entry agent. Waits for the result by default and returns the full transcript; the run also streams into the app window.',
      inputSchema: {
        input: z.string(),
        wait: z.boolean().optional(),
        timeoutSeconds: z.number().optional()
      }
    },
    async ({ input, wait, timeoutSeconds }) => {
      const document = deps.document.get()
      const issues = validateGraph(document.graph)
      if (hasErrors(issues)) {
        return fail(
          `This graph cannot run yet: ${issues
            .filter((i) => i.level === 'error')
            .map((i) => i.message)
            .join(' ')}`
        )
      }
      const runId = deps.runs.start(document.graph, input)
      if (wait === false) return ok({ runId, status: 'running' })

      const seconds = timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
      const record = await deps.runs.wait(runId, Math.max(0, seconds) * 1000)
      if (!record) return fail(`Run ${runId} disappeared before it could be read.`)
      const described = describeRun(record) as Record<string, unknown>
      if (record.status === 'running') {
        described['note'] = `Still running after ${seconds}s. Call get_run with this runId to read it later, or stop_run to end it.`
      }
      return ok(described)
    }
  )

  server.registerTool(
    'get_run',
    { description: 'Read a run and its transcript by id.', inputSchema: { runId: z.string() } },
    ({ runId }) => {
      const record = deps.runs.get(runId)
      return record ? ok(describeRun(record)) : fail(`No run with id "${runId}".`)
    }
  )

  server.registerTool(
    'stop_run',
    { description: 'Stop a run that is still going.', inputSchema: { runId: z.string() } },
    ({ runId }) => {
      if (!deps.runs.stop(runId)) return fail(`No run with id "${runId}".`)
      return ok({ runId, stopped: true })
    }
  )

  server.registerTool(
    'list_runs',
    { description: 'List recent runs, newest first, without their transcripts.', inputSchema: { limit: z.number().optional() } },
    ({ limit }) =>
      ok({
        runs: deps.runs.list(limit).map((summary) => ({
          runId: summary.id,
          status: summary.status,
          input: summary.input,
          output: summary.output,
          error: summary.error,
          startedAt: summary.startedAt,
          finishedAt: summary.finishedAt
        }))
      })
  )
}

export { describeRun }
```

- [ ] **Step 4: Register the run tools and the run resource**

In `src/main/control/server.ts`, add these imports below the existing ones:

```ts
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describeRun, registerRunTools } from './tools-runs'
```

(merge `ResourceTemplate` into the existing `McpServer` import from the same module rather than importing twice), add `registerRunTools(server, deps)` immediately after `registerDocumentTools(server, deps)`, and add this resource registration after the `document` one:

```ts
  server.registerResource(
    'run',
    new ResourceTemplate('agentgraph://runs/{runId}', { list: undefined }),
    { title: 'Run transcript', description: 'One run and its transcript.', mimeType: 'application/json' },
    (uri, variables) => {
      const runId = String(variables['runId'])
      const record = deps.runs.get(runId)
      if (!record) throw new Error(`No run with id "${runId}".`)
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(describeRun(record), null, 2) }]
      }
    }
  )
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/main/control && npm run typecheck`
Expected: both control test files pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/control
git commit -m "Add run tools to the control server

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: MCP server and model tools

**Files:**
- Create: `src/main/control/tools-settings.ts`
- Create: `src/main/control/tools-settings.test.ts`
- Modify: `src/main/control/server.ts`

**Interfaces:**
- Consumes: `ControlDeps`, `ok`, `fail`; `newId` from `@shared/graph-defaults`; `McpServerConfig` from `@shared/types`.
- Produces: `registerSettingsTools(server, deps)`, `redactServer(config)`.

- [ ] **Step 1: Write the failing test**

Create `src/main/control/tools-settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { harness } from './test-harness'
import type { McpServerConfig } from '@shared/types'

describe('settings tools', () => {
  it('lists configured servers with env and header values redacted', async () => {
    const h = await harness()
    h.deps.settings.update({
      mcpServers: [
        { id: 's1', name: 'FreeCAD', transport: 'stdio', command: 'uvx', args: ['freecad-mcp'], env: { TOKEN: 'secret' } },
        { id: 's2', name: 'Remote', transport: 'http', url: 'https://x/mcp', headers: { Authorization: 'Bearer secret' } }
      ]
    })
    const result = await h.call('list_mcp_servers')
    const text = result.text
    expect(text).not.toContain('secret')
    expect(result.payload.servers[0]).toMatchObject({ id: 's1', name: 'FreeCAD', transport: 'stdio', command: 'uvx', envNames: ['TOKEN'] })
    expect(result.payload.servers[1]).toMatchObject({ id: 's2', transport: 'http', url: 'https://x/mcp', headerNames: ['Authorization'] })
  })

  it('adds a server only after a successful connection test', async () => {
    const tested: McpServerConfig[] = []
    const h = await harness({
      mcp: {
        invalidate: async () => undefined,
        test: async (config) => {
          tested.push(config)
          return [{ serverId: config.id, serverName: config.name, name: 'ping', description: 'Pings', inputSchema: { type: 'object' } }]
        }
      }
    })
    const result = await h.call('add_mcp_server', { name: 'Local', transport: 'stdio', command: 'npx', args: ['-y', 'thing'] })
    expect(result.isError).toBe(false)
    expect(result.payload).toMatchObject({ name: 'Local', tools: ['ping'] })
    expect(tested).toHaveLength(1)
    expect(h.deps.settings.get().mcpServers).toHaveLength(1)
  })

  it('rejects a server that fails to connect and does not save it', async () => {
    const h = await harness({
      mcp: {
        invalidate: async () => undefined,
        test: async () => {
          throw new Error('command not found')
        }
      }
    })
    const result = await h.call('add_mcp_server', { name: 'Broken', transport: 'stdio', command: 'nope' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('command not found')
    expect(h.deps.settings.get().mcpServers).toEqual([])
  })

  it('requires the fields that match the chosen transport', async () => {
    const h = await harness()
    expect((await h.call('add_mcp_server', { name: 'X', transport: 'stdio' })).text).toContain('command')
    expect((await h.call('add_mcp_server', { name: 'X', transport: 'http' })).text).toContain('url')
  })

  it('tests and removes a configured server by name', async () => {
    const h = await harness({
      mcp: {
        invalidate: async () => undefined,
        test: async (config) => [
          { serverId: config.id, serverName: config.name, name: 'ping', description: '', inputSchema: { type: 'object' } }
        ]
      }
    })
    h.deps.settings.update({
      mcpServers: [{ id: 's1', name: 'FreeCAD', transport: 'stdio', command: 'uvx', args: [] }]
    })
    const tested = await h.call('test_mcp_server', { server: 'FreeCAD' })
    expect(tested.payload.tools[0]).toMatchObject({ name: 'ping' })

    const removed = await h.call('remove_mcp_server', { server: 'FreeCAD' })
    expect(removed.payload).toEqual({ removedServerId: 's1' })
    expect(h.deps.settings.get().mcpServers).toEqual([])
    expect((await h.call('remove_mcp_server', { server: 'Ghost' })).isError).toBe(true)
  })

  it('lists models for a provider', async () => {
    const h = await harness()
    const result = await h.call('list_models', { provider: 'anthropic' })
    expect(result.payload).toMatchObject({ provider: 'anthropic', source: 'fallback', models: ['claude-opus-5'] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/control/tools-settings.test.ts`
Expected: FAIL, `list_mcp_servers` is not a registered tool.

- [ ] **Step 3: Implement**

Create `src/main/control/tools-settings.ts`:

```ts
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PROVIDER_IDS, type McpServerConfig, type ProviderId } from '@shared/types'
import { newId } from '@shared/graph-defaults'
import { errorMessage } from '@shared/errors'
import type { ControlDeps } from './deps'
import { fail, ok } from './result'

/** Keeps the shape of a server visible while hiding anything that might be a credential. */
export function redactServer(config: McpServerConfig): unknown {
  const base = { id: config.id, name: config.name, transport: config.transport }
  if (config.transport === 'stdio') {
    return { ...base, command: config.command, args: config.args, envNames: Object.keys(config.env ?? {}) }
  }
  return { ...base, url: config.url, headerNames: Object.keys(config.headers ?? {}) }
}

function findServer(deps: ControlDeps, reference: string): McpServerConfig | undefined {
  const trimmed = reference.trim().toLowerCase()
  const servers = deps.settings.get().mcpServers
  return servers.find((s) => s.id === reference.trim()) ?? servers.find((s) => s.name.trim().toLowerCase() === trimmed)
}

export function registerSettingsTools(server: McpServer, deps: ControlDeps): void {
  server.registerTool(
    'list_mcp_servers',
    { description: 'List the MCP servers agents can draw tools from. Environment and header values are hidden.' },
    () => ok({ servers: deps.settings.get().mcpServers.map(redactServer) })
  )

  server.registerTool(
    'add_mcp_server',
    {
      description:
        'Add an MCP server that agents can use. The connection is tested first and the server is only saved if it answers.',
      inputSchema: {
        name: z.string(),
        transport: z.enum(['stdio', 'http']),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        url: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional()
      }
    },
    async ({ name, transport, command, args, env, url, headers }) => {
      let config: McpServerConfig
      if (transport === 'stdio') {
        if (!command?.trim()) return fail('A stdio server needs a command.')
        config = { id: newId(), name: name.trim() || 'MCP server', transport: 'stdio', command: command.trim(), args: args ?? [] }
        if (env && Object.keys(env).length > 0) config.env = env
      } else {
        if (!url?.trim()) return fail('An http server needs a url.')
        config = { id: newId(), name: name.trim() || 'MCP server', transport: 'http', url: url.trim() }
        if (headers && Object.keys(headers).length > 0) config.headers = headers
      }

      try {
        const tools = await deps.mcp.test(config)
        deps.settings.update({ mcpServers: [...deps.settings.get().mcpServers, config] })
        return ok({ ...(redactServer(config) as object), tools: tools.map((t) => t.name) })
      } catch (err) {
        return fail(`Could not connect to that server, so it was not saved: ${errorMessage(err)}`)
      }
    }
  )

  server.registerTool(
    'remove_mcp_server',
    { description: 'Remove a configured MCP server. Give it by id or name.', inputSchema: { server: z.string() } },
    async ({ server: reference }) => {
      const config = findServer(deps, reference)
      if (!config) return fail(`No MCP server matches "${reference}".`)
      deps.settings.update({ mcpServers: deps.settings.get().mcpServers.filter((s) => s.id !== config.id) })
      await deps.mcp.invalidate(config.id)
      return ok({ removedServerId: config.id })
    }
  )

  server.registerTool(
    'test_mcp_server',
    { description: 'Connect to a configured MCP server and list the tools it offers.', inputSchema: { server: z.string() } },
    async ({ server: reference }) => {
      const config = findServer(deps, reference)
      if (!config) return fail(`No MCP server matches "${reference}".`)
      try {
        const tools = await deps.mcp.test(config)
        return ok({ id: config.id, name: config.name, tools: tools.map((t) => ({ name: t.name, description: t.description })) })
      } catch (err) {
        return fail(errorMessage(err))
      }
    }
  )

  server.registerTool(
    'list_models',
    {
      description: 'List the models a provider offers. Falls back to a built-in list when no API key is configured.',
      inputSchema: { provider: z.enum(PROVIDER_IDS as [string, ...string[]]) }
    },
    async ({ provider }) => {
      const result = await deps.listModels(provider as ProviderId)
      return ok({ provider, models: result.models, source: result.source, error: result.error })
    }
  )
}
```

- [ ] **Step 4: Register them**

In `src/main/control/server.ts`, import `registerSettingsTools` from `./tools-settings` and call `registerSettingsTools(server, deps)` after `registerRunTools(server, deps)`.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/main/control && npm run typecheck && npm test`
Expected: all three control test files pass; typecheck clean; full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/main/control
git commit -m "Add MCP server and model tools to the control server

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Loopback listener and lifecycle manager

**Files:**
- Modify: `src/shared/types.ts`, `src/main/settings.ts`, `src/main/settings.test.ts`
- Create: `src/main/control/http.ts`
- Create: `src/main/control/manager.ts`
- Create: `src/main/control/http.test.ts`
- Create: `src/main/control/manager.test.ts`

**Interfaces:**
- Consumes: `buildControlServer` from `./server`; `ControlDeps` from `./deps`; `Settings` from `@shared/types`.
- Produces: `RemoteControlSettings` and `DEFAULT_REMOTE_CONTROL` in `@shared/types`; `CONTROL_PATH`, `ControlListener`, `startControlListener(options)` from `./http`; `ControlStatus`, `CONTROL_TOKEN_KEY`, `ControlManager` from `./manager`.

- [ ] **Step 1: Add the remote control settings shape**

In `src/shared/types.ts`, add above `Settings`:

```ts
export interface RemoteControlSettings {
  enabled: boolean
  port: number
}

export const DEFAULT_REMOTE_CONTROL: RemoteControlSettings = { enabled: false, port: 4820 }
```

add `remoteControl: RemoteControlSettings` to `Settings` (after `limits`), and add `remoteControl: DEFAULT_REMOTE_CONTROL` to `DEFAULT_SETTINGS`.

In `src/main/settings.ts`, inside `normalizeSettings`, add before the `return`:

```ts
  const remote = (r.remoteControl && typeof r.remoteControl === 'object' ? r.remoteControl : {}) as Partial<RemoteControlSettings>
  const port =
    typeof remote.port === 'number' && Number.isInteger(remote.port) && remote.port >= 1 && remote.port <= 65535
      ? remote.port
      : DEFAULT_REMOTE_CONTROL.port
```

and add to the returned object:

```ts
    remoteControl: { enabled: remote.enabled === true, port },
```

Import `DEFAULT_REMOTE_CONTROL` and the `RemoteControlSettings` type from `@shared/types`.

Append to `src/main/settings.test.ts`:

```ts
describe('normalizeSettings remoteControl', () => {
  it('defaults to disabled on port 4820 and rejects a bad port', () => {
    expect(normalizeSettings({}).remoteControl).toEqual({ enabled: false, port: 4820 })
    expect(normalizeSettings({ remoteControl: { enabled: true, port: 5000 } }).remoteControl).toEqual({ enabled: true, port: 5000 })
    expect(normalizeSettings({ remoteControl: { enabled: 'yes', port: 0 } }).remoteControl).toEqual({ enabled: false, port: 4820 })
    expect(normalizeSettings({ remoteControl: { port: 70000 } }).remoteControl).toEqual({ enabled: false, port: 4820 })
  })
})
```

- [ ] **Step 2: Write the failing listener test**

Create `src/main/control/http.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startControlListener, type ControlListener } from './http'
import type { ControlDeps } from './deps'
import { DocumentService } from '../document-service'
import { RunService } from '../run-service'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

const TOKEN = 'a'.repeat(64)
let listener: ControlListener | null = null

function deps(): ControlDeps {
  let settings: Settings = { ...DEFAULT_SETTINGS }
  return {
    document: new DocumentService(() => undefined),
    runs: new RunService({ startRun: () => new Promise(() => undefined), broadcast: () => undefined }),
    settings: {
      get: () => settings,
      update: (patch) => {
        settings = { ...settings, ...patch }
        return settings
      }
    },
    mcp: { test: async () => [], invalidate: async () => undefined },
    listModels: async () => ({ models: [], source: 'fallback' }),
    readGraphFile: async () => {
      throw new Error('not used')
    },
    writeGraphFile: async () => undefined
  }
}

afterEach(async () => {
  await listener?.close()
  listener = null
})

describe('control listener', () => {
  it('serves MCP to a client that presents the token', async () => {
    listener = await startControlListener({ port: 0, token: TOKEN, deps: deps() })
    const transport = new StreamableHTTPClientTransport(new URL(listener.url), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } }
    })
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(transport)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('get_graph')
    await client.close()
  })

  it('rejects a missing or wrong token with 401', async () => {
    listener = await startControlListener({ port: 0, token: TOKEN, deps: deps() })
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

    const anonymous = await fetch(listener.url, { method: 'POST', headers, body })
    expect(anonymous.status).toBe(401)

    const wrong = await fetch(listener.url, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${'b'.repeat(64)}` },
      body
    })
    expect(wrong.status).toBe(401)
  })

  it('answers 404 away from the MCP path', async () => {
    listener = await startControlListener({ port: 0, token: TOKEN, deps: deps() })
    const response = await fetch(`${listener.url.replace('/mcp', '')}/elsewhere`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    })
    expect(response.status).toBe(404)
  })

  it('reports a port that is already taken', async () => {
    listener = await startControlListener({ port: 0, token: TOKEN, deps: deps() })
    await expect(startControlListener({ port: listener.port, token: TOKEN, deps: deps() })).rejects.toThrow(/EADDRINUSE|address already in use/i)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/control/http.test.ts`
Expected: FAIL, cannot find module `./http`.

- [ ] **Step 4: Implement the listener**

Create `src/main/control/http.ts`:

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { timingSafeEqual } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { errorMessage } from '@shared/errors'
import { buildControlServer } from './server'
import type { ControlDeps } from './deps'

export const CONTROL_PATH = '/mcp'
const HOST = '127.0.0.1'

export interface ControlListener {
  port: number
  url: string
  close(): Promise<void>
}

export interface ControlListenerOptions {
  port: number
  token: string
  deps: ControlDeps
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body)
}

/** Compares in constant time so the token cannot be guessed a character at a time. */
function authorized(header: string | undefined, token: string): boolean {
  const prefix = 'Bearer '
  if (!header || !header.startsWith(prefix)) return false
  const given = Buffer.from(header.slice(prefix.length).trim(), 'utf8')
  const expected = Buffer.from(token, 'utf8')
  if (given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}

export async function startControlListener(options: ControlListenerOptions): Promise<ControlListener> {
  const sockets = new Set<Socket>()
  let boundPort = options.port

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? HOST}`)
    if (url.pathname !== CONTROL_PATH) {
      sendJson(res, 404, { error: `Nothing here. The MCP endpoint is ${CONTROL_PATH}.` })
      return
    }
    if (!authorized(req.headers.authorization, options.token)) {
      res.setHeader('WWW-Authenticate', 'Bearer')
      sendJson(res, 401, { error: 'A valid bearer token is required. Copy it from Settings, Remote control.' })
      return
    }

    // Stateless: one server and transport per request, so there are no sessions to track.
    const server = buildControlServer(options.deps)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [`${HOST}:${boundPort}`, `localhost:${boundPort}`]
    })
    res.on('close', () => {
      void transport.close().catch(() => undefined)
      void server.close().catch(() => undefined)
    })
    await server.connect(transport)
    await transport.handleRequest(req, res)
  }

  const httpServer: Server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: errorMessage(err) })
      else res.end()
    })
  })

  httpServer.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err)
    httpServer.once('error', onError)
    httpServer.listen(options.port, HOST, () => {
      httpServer.removeListener('error', onError)
      resolve()
    })
  })

  const address = httpServer.address()
  boundPort = typeof address === 'object' && address ? address.port : options.port

  return {
    port: boundPort,
    url: `http://${HOST}:${boundPort}${CONTROL_PATH}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        sockets.clear()
        httpServer.close(() => resolve())
      })
  }
}
```

- [ ] **Step 5: Write the failing manager test**

Create `src/main/control/manager.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { ControlManager, CONTROL_TOKEN_KEY } from './manager'
import type { ControlDeps } from './deps'
import { DocumentService } from '../document-service'
import { RunService } from '../run-service'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

function controlDeps(): ControlDeps {
  let settings: Settings = { ...DEFAULT_SETTINGS }
  return {
    document: new DocumentService(() => undefined),
    runs: new RunService({ startRun: () => new Promise(() => undefined), broadcast: () => undefined }),
    settings: {
      get: () => settings,
      update: (patch) => {
        settings = { ...settings, ...patch }
        return settings
      }
    },
    mcp: { test: async () => [], invalidate: async () => undefined },
    listModels: async () => ({ models: [], source: 'fallback' }),
    readGraphFile: async () => {
      throw new Error('not used')
    },
    writeGraphFile: async () => undefined
  }
}

interface Fixture {
  manager: ControlManager
  setSettings: (patch: Partial<Settings>) => void
  secrets: Map<string, string>
}

function fixture(): Fixture {
  let settings: Settings = { ...DEFAULT_SETTINGS, remoteControl: { enabled: false, port: 0 } }
  const secrets = new Map<string, string>()
  const manager = new ControlManager({
    settings: { get: () => settings },
    secrets: {
      get: (name) => secrets.get(name) ?? null,
      set: (name, value) => {
        secrets.set(name, value)
      }
    },
    buildControlDeps: controlDeps
  })
  return {
    manager,
    secrets,
    setSettings: (patch) => {
      settings = { ...settings, ...patch }
    }
  }
}

let open: ControlManager | null = null
afterEach(async () => {
  await open?.stop()
  open = null
})

describe('ControlManager', () => {
  it('stays stopped while remote control is disabled', async () => {
    const f = fixture()
    open = f.manager
    const status = await f.manager.sync()
    expect(status).toMatchObject({ enabled: false, url: null, error: null })
    expect(status.token).toHaveLength(64)
  })

  it('mints a token once and reuses it', async () => {
    const f = fixture()
    open = f.manager
    const first = await f.manager.sync()
    const second = await f.manager.sync()
    expect(second.token).toBe(first.token)
    expect(f.secrets.get(CONTROL_TOKEN_KEY)).toBe(first.token)
  })

  it('starts a listener when enabled and stops it when disabled', async () => {
    const f = fixture()
    open = f.manager
    f.setSettings({ remoteControl: { enabled: true, port: 0 } })
    const started = await f.manager.sync()
    expect(started.enabled).toBe(true)
    expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(started.error).toBeNull()

    const response = await fetch(started.url!, { method: 'POST' })
    expect(response.status).toBe(401)

    f.setSettings({ remoteControl: { enabled: false, port: 0 } })
    const stopped = await f.manager.sync()
    expect(stopped.url).toBeNull()
  })

  it('replaces the token and restarts the listener on regenerate', async () => {
    const f = fixture()
    open = f.manager
    f.setSettings({ remoteControl: { enabled: true, port: 0 } })
    const before = await f.manager.sync()
    const after = await f.manager.regenerateToken()
    expect(after.token).not.toBe(before.token)
    expect(after.url).not.toBeNull()
    expect(f.secrets.get(CONTROL_TOKEN_KEY)).toBe(after.token)
  })

  it('reports a bind failure without throwing', async () => {
    const first = fixture()
    open = first.manager
    first.setSettings({ remoteControl: { enabled: true, port: 0 } })
    const started = await first.manager.sync()
    const port = Number(new URL(started.url!).port)

    const second = fixture()
    second.setSettings({ remoteControl: { enabled: true, port } })
    const failed = await second.manager.sync()
    expect(failed.url).toBeNull()
    expect(failed.error).toMatch(/EADDRINUSE|address already in use/i)
    await second.manager.stop()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/main/control/manager.test.ts`
Expected: FAIL, cannot find module `./manager`.

- [ ] **Step 7: Implement the manager**

Create `src/main/control/manager.ts`:

```ts
import { randomBytes } from 'node:crypto'
import type { Settings } from '@shared/types'
import { errorMessage } from '@shared/errors'
import type { ControlDeps } from './deps'
import { startControlListener, type ControlListener } from './http'

export const CONTROL_TOKEN_KEY = 'remoteControlToken'

export interface ControlStatus {
  enabled: boolean
  port: number
  /** The address to give a client, or null when the listener is not running. */
  url: string | null
  token: string
  error: string | null
}

export interface ControlManagerDeps {
  settings: { get(): Settings }
  secrets: { get(name: string): string | null; set(name: string, value: string): void }
  buildControlDeps: () => ControlDeps
}

/** Keeps the listener matching the settings, and owns the bearer token. */
export class ControlManager {
  private listener: ControlListener | null = null
  private startedWith: { port: number; token: string } | null = null
  private error: string | null = null

  constructor(private readonly deps: ControlManagerDeps) {}

  status(): ControlStatus {
    const settings = this.deps.settings.get().remoteControl
    return {
      enabled: settings.enabled,
      port: settings.port,
      url: this.listener?.url ?? null,
      token: this.token(),
      error: this.error
    }
  }

  /** Starts, stops, or restarts the listener so it matches the current settings. */
  async sync(): Promise<ControlStatus> {
    const wanted = this.deps.settings.get().remoteControl
    const token = this.token()

    if (!wanted.enabled) {
      await this.stop()
      this.error = null
      return this.status()
    }

    const unchanged = this.listener !== null && this.startedWith?.port === wanted.port && this.startedWith.token === token
    if (unchanged) return this.status()

    await this.stop()
    try {
      this.listener = await startControlListener({ port: wanted.port, token, deps: this.deps.buildControlDeps() })
      this.startedWith = { port: wanted.port, token }
      this.error = null
    } catch (err) {
      this.listener = null
      this.startedWith = null
      this.error = errorMessage(err)
    }
    return this.status()
  }

  async regenerateToken(): Promise<ControlStatus> {
    this.deps.secrets.set(CONTROL_TOKEN_KEY, randomBytes(32).toString('hex'))
    await this.stop()
    return this.sync()
  }

  async stop(): Promise<void> {
    const listener = this.listener
    this.listener = null
    this.startedWith = null
    await listener?.close()
  }

  private token(): string {
    const existing = this.deps.secrets.get(CONTROL_TOKEN_KEY)
    if (existing) return existing
    const minted = randomBytes(32).toString('hex')
    this.deps.secrets.set(CONTROL_TOKEN_KEY, minted)
    return minted
  }
}
```

- [ ] **Step 8: Run tests and typecheck**

Run: `npx vitest run src/main/control && npm run typecheck`
Expected: all control tests pass; typecheck clean. The listener tests bind real loopback ports; if the sandbox forbids that, report it rather than weakening the tests.

- [ ] **Step 9: Commit**

```bash
git add src/shared/types.ts src/main/settings.ts src/main/settings.test.ts src/main/control
git commit -m "Serve the control server over loopback with a bearer token

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Wire the services into the app

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`
- Create: `src/main/services.ts`
- Modify: `src/main/ipc.ts`, `src/main/index.ts`, `src/main/ipc.test.ts`

**Interfaces:**
- Produces: `IPC.syncDocument`, `IPC.documentChanged`, `IPC.controlStatus`, `IPC.regenerateControlToken`, `DocumentPayload`, and the four new `Api` methods in `@shared/ipc`; `createServices` in `src/main/services.ts`; `MainContext` in `src/main/ipc.ts` gains `document`, `runs`, `control`.

- [ ] **Step 1: Extend the IPC contract**

In `src/shared/ipc.ts`, add to the `IPC` object:

```ts
  syncDocument: 'document:sync',
  documentChanged: 'document:changed',
  controlStatus: 'control:status',
  regenerateControlToken: 'control:regenerateToken',
```

add these types:

```ts
export interface DocumentPayload {
  graph: Graph
  path: string | null
  dirty: boolean
  revision: number
}

export interface ControlStatusPayload {
  enabled: boolean
  port: number
  url: string | null
  token: string
  error: string | null
}
```

and add to `Api`:

```ts
  syncDocument(document: { graph: Graph; path: string | null; dirty: boolean }): void
  onDocumentChanged(listener: (document: DocumentPayload) => void): () => void
  getControlStatus(): Promise<ControlStatusPayload>
  regenerateControlToken(): Promise<ControlStatusPayload>
```

In `src/preload/index.ts`, add the matching implementations to the `api` object:

```ts
  syncDocument: (document) => {
    ipcRenderer.send(IPC.syncDocument, document)
  },
  onDocumentChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, document: DocumentPayload): void => listener(document)
    ipcRenderer.on(IPC.documentChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC.documentChanged, handler)
    }
  },
  getControlStatus: () => ipcRenderer.invoke(IPC.controlStatus),
  regenerateControlToken: () => ipcRenderer.invoke(IPC.regenerateControlToken),
```

importing `type DocumentPayload` alongside the existing `@shared/ipc` imports.

- [ ] **Step 2: Create the service factory**

Create `src/main/services.ts`. `collectMcpTools` and `workspaceIdFor` move here **out of** `src/main/ipc.ts` (delete them there):

```ts
import type { BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { IPC } from '@shared/ipc'
import type { RunEvent } from '@shared/events'
import type { Graph, ProviderId, ToolGrant } from '@shared/types'
import { errorMessage } from '@shared/errors'
import type { SettingsStore } from './settings'
import type { SecretStore } from './secrets'
import type { McpRegistry } from './mcp/registry'
import type { McpToolInfo } from './runtime/graph-tools'
import { getProvider, listModelsWithFallback } from './providers'
import { runGraph, type EngineDeps } from './runtime/engine'
import { parseGraphFile, serializeGraph } from './graph-files'
import { writeFileAtomic } from './fs-utils'
import { DocumentService } from './document-service'
import { RunService } from './run-service'
import { ControlManager } from './control/manager'
import type { ControlDeps } from './control/deps'

export interface ServiceInput {
  settings: SettingsStore
  secrets: SecretStore
  mcp: McpRegistry
  getWindows: () => BrowserWindow[]
}

export interface Services {
  document: DocumentService
  runs: RunService
  control: ControlManager
}

function workspaceIdFor(settings: SettingsStore, provider: ProviderId): string | undefined {
  return provider === 'anthropic' ? settings.get().anthropicWorkspaceId : undefined
}

async function collectMcpTools(
  input: ServiceInput,
  grants: ToolGrant[],
  signal?: AbortSignal
): Promise<{ tools: McpToolInfo[]; warnings: string[] }> {
  const tools: McpToolInfo[] = []
  const warnings: string[] = []
  const configured = input.settings.get().mcpServers
  for (const serverId of new Set(grants.map((g) => g.serverId))) {
    const config = configured.find((s) => s.id === serverId)
    if (!config) {
      warnings.push(`A node references MCP server "${serverId}", which is no longer configured; its tools were skipped.`)
      continue
    }
    try {
      tools.push(...(await input.mcp.listTools(serverId, signal)))
    } catch (err) {
      warnings.push(`Could not connect to MCP server "${config.name}": ${errorMessage(err)}`)
    }
  }
  return { tools, warnings }
}

export function createEngineDeps(input: ServiceInput, emit: (event: RunEvent) => void): EngineDeps {
  return {
    getProvider,
    getApiKey: async (id) => input.secrets.get(id),
    getWorkspaceId: (id) => workspaceIdFor(input.settings, id),
    listMcpTools: (grants, signal) => collectMcpTools(input, grants, signal),
    callMcpTool: (ref, args, signal) => input.mcp.callTool(ref, args, signal),
    limits: input.settings.get().limits,
    emit
  }
}

/** Builds the document mirror, the run service, and the remote-control manager over one app context. */
export function createServices(input: ServiceInput): Services {
  const send = (channel: string, payload: unknown): void => {
    for (const win of input.getWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  const document = new DocumentService((doc) => send(IPC.documentChanged, doc))

  const runs = new RunService({
    broadcast: (event) => send(IPC.runEvent, event),
    startRun: ({ runId, graph, input: message, signal, emit }) =>
      runGraph({ runId, graph, input: message, signal, deps: createEngineDeps(input, emit) })
  })

  const buildControlDeps = (): ControlDeps => ({
    document,
    runs,
    settings: { get: () => input.settings.get(), update: (patch) => input.settings.update(patch) },
    mcp: { test: (config) => input.mcp.test(config), invalidate: (serverId) => input.mcp.invalidate(serverId) },
    listModels: (provider) => listModelsWithFallback(provider, input.secrets.get(provider), workspaceIdFor(input.settings, provider)),
    readGraphFile: async (path: string): Promise<Graph> => parseGraphFile(await readFile(path, 'utf8')),
    writeGraphFile: async (path: string, graph: Graph): Promise<void> => {
      writeFileAtomic(path, serializeGraph(graph))
    }
  })

  const control = new ControlManager({
    settings: { get: () => input.settings.get() },
    secrets: {
      get: (name) => input.secrets.get(name),
      set: (name, value) => input.secrets.set(name, value)
    },
    buildControlDeps
  })

  return { document, runs, control }
}
```

- [ ] **Step 3: Rewire the IPC layer**

In `src/main/ipc.ts`:

1. Delete `collectMcpTools`, `workspaceIdFor`, and the now-unused imports (`getProvider`, `runGraph`, `EngineDeps`, `McpToolInfo`, `RunEvent`, `ToolGrant`, `ProviderId` stays if still referenced).
2. Extend `MainContext`:

```ts
export interface MainContext {
  settings: SettingsStore
  secrets: SecretStore
  mcp: McpRegistry
  document: DocumentService
  runs: RunService
  control: ControlManager
  getWindow: () => BrowserWindow | null
}
```

with imports for `DocumentService`, `RunService`, `ControlManager`, and `DocumentPayload`.

3. Change `listModels` to use the shared helper it already calls, keeping the workspace id by reading it from settings inline:

```ts
  ipcMain.handle(IPC.listModels, (_event, provider: ProviderId) =>
    listModelsWithFallback(
      provider,
      ctx.secrets.get(provider),
      provider === 'anthropic' ? ctx.settings.get().anthropicWorkspaceId : undefined
    )
  )
```

4. Replace the whole `IPC.startRun` handler and the `runs` map with:

```ts
  ipcMain.handle(IPC.startRun, (_event, graph: Graph, input: string): string => ctx.runs.start(graph, input))

  ipcMain.handle(IPC.stopRun, (_event, runId: string) => {
    ctx.runs.stop(runId)
  })
```

(delete `const runs = new Map<string, AbortController>()`).

5. Add the document and control handlers at the end of `registerIpc`:

```ts
  ipcMain.on(IPC.syncDocument, (_event, document: { graph: Graph; path: string | null; dirty: boolean }) => {
    ctx.document.syncFromRenderer(document)
  })

  ipcMain.handle(IPC.controlStatus, () => ctx.control.status())
  ipcMain.handle(IPC.regenerateControlToken, () => ctx.control.regenerateToken())
```

6. In the `IPC.updateSettings` handler, after the invalidation loop and before `return after`, add:

```ts
    if (JSON.stringify(before.remoteControl) !== JSON.stringify(after.remoteControl)) void ctx.control.sync()
```

- [ ] **Step 4: Rewire the main entry**

In `src/main/index.ts`, replace the body of the `app.whenReady()` callback with:

```ts
  const userData = app.getPath('userData')
  const settings = new SettingsStore(join(userData, 'settings.json'))
  const secrets = new SecretStore(join(userData, 'secrets.bin'), electronCipher())
  const mcp = new McpRegistry(() => settings.get().mcpServers)
  const services = createServices({ settings, secrets, mcp, getWindows: () => BrowserWindow.getAllWindows() })

  registerIpc({ settings, secrets, mcp, ...services, getWindow: () => mainWindow })
  void services.control.sync()
  createWindow(settings.get().theme)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(settings.get().theme)
  })
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    services.runs.stopAll()
    void Promise.race([
      Promise.all([mcp.closeAll(), services.control.stop()]),
      new Promise<void>((resolve) => setTimeout(resolve, 3000))
    ])
      .catch(() => undefined)
      .finally(() => app.quit())
  })
```

adding `import { createServices } from './services'`.

- [ ] **Step 5: Extend the IPC tests**

`src/main/ipc.test.ts` builds its context in `setup()`. Three edits, then two new tests.

First, the electron mock must record `ipcMain.on` as well as `handle`. Change the `vi.hoisted` block and the mock to:

```ts
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  listeners: new Map<string, Handler>(),
  showSaveDialog: vi.fn(),
  showOpenDialog: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      mocks.handlers.set(channel, fn)
    },
    on: (channel: string, fn: Handler): void => {
      mocks.listeners.set(channel, fn)
    }
  },
  dialog: {
    showSaveDialog: mocks.showSaveDialog,
    showOpenDialog: mocks.showOpenDialog
  }
}))
```

Second, in `setup()`, clear the new map next to the existing `mocks.handlers.clear()`:

```ts
  mocks.listeners.clear()
```

and replace the `registerIpc({ ... })` call and the `invoke` helper with this, so the services under test are the real ones and run events still reach `sender.send`:

```ts
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: sender.send }
  } as unknown as BrowserWindow

  const services = createServices({
    settings,
    secrets,
    mcp: registry as unknown as Parameters<typeof createServices>[0]['mcp'],
    getWindows: () => [fakeWindow]
  })

  registerIpc({
    settings,
    secrets,
    mcp: registry as unknown as Parameters<typeof registerIpc>[0]['mcp'],
    ...services,
    getWindow: () => null
  })

  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = mocks.handlers.get(channel)
    if (!handler) throw new Error(`no handler registered for ${channel}`)
    return handler(event, ...args)
  }

  const send = (channel: string, ...args: unknown[]): void => {
    const listener = mocks.listeners.get(channel)
    if (!listener) throw new Error(`no listener registered for ${channel}`)
    listener(event, ...args)
  }

  return { settings, secrets, registry, sender, event, invoke, send, services }
```

Widen the declared return type of `setup()` to match by adding `send: (channel: string, ...args: unknown[]) => void` and `services: ReturnType<typeof createServices>`, and add `import { createServices } from './services'` plus `import type { BrowserWindow } from 'electron'` at the top.

Third, append these tests:

```ts
describe('document mirror and remote control', () => {
  it('mirrors the document the renderer reports', () => {
    const { send, services } = setup()
    const graph = emptyGraph('Synced')
    send(IPC.syncDocument, { graph, path: '/tmp/a.json', dirty: true })
    expect(services.document.get()).toMatchObject({ path: '/tmp/a.json', dirty: true })
    expect(services.document.get().graph.name).toBe('Synced')
  })

  it('pushes a document mutated over MCP back to the window', () => {
    const { sender, services } = setup()
    services.document.replace(emptyGraph('From MCP'), null, true)
    const pushed = sender.send.mock.calls.find((call) => call[0] === IPC.documentChanged)
    expect(pushed).toBeDefined()
    expect((pushed?.[1] as { graph: Graph }).graph.name).toBe('From MCP')
  })

  it('reports the control status and replaces the token on request', async () => {
    const { invoke } = setup()
    const before = (await invoke(IPC.controlStatus)) as { enabled: boolean; token: string; url: string | null }
    expect(before).toMatchObject({ enabled: false, url: null })
    expect(before.token).toHaveLength(64)

    const after = (await invoke(IPC.regenerateControlToken)) as { token: string }
    expect(after.token).toHaveLength(64)
    expect(after.token).not.toBe(before.token)
  })
})
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass. Then launch: `npx electron-vite dev > /tmp/agent-graph-dev.log 2>&1 &`, wait 20 s, check the log for errors, and kill it.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "Wire the document, run, and control services into the app

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Mirror the document from the renderer

**Files:**
- Modify: `src/renderer/store/graph.ts`, `src/renderer/store/graph.test.ts`
- Create: `src/renderer/lib/document-sync.ts`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Produces: `applyRemote(graph, path, dirty)` on the graph store; `useDocumentSync()` from `@/lib/document-sync`.

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/store/graph.test.ts`:

```ts
describe('remote documents', () => {
  it('adopts a document pushed from the main process, keeping its dirty flag', () => {
    const g = emptyGraph('Remote')
    s().applyRemote(g, '/tmp/remote.json', true)
    expect(s().graph.name).toBe('Remote')
    expect(s().path).toBe('/tmp/remote.json')
    expect(s().dirty).toBe(true)
    s().applyRemote(emptyGraph('Saved'), '/tmp/remote.json', false)
    expect(s().dirty).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/store/graph.test.ts`
Expected: FAIL, `applyRemote` is not a function.

- [ ] **Step 3: Add the store action**

In `src/renderer/store/graph.ts`, add `applyRemote(graph: Graph, path: string | null, dirty: boolean): void` to the `GraphState` interface and this implementation next to `setGraph`:

```ts
    applyRemote(graph, path, dirty) {
      set({ graph, path, dirty })
    },
```

- [ ] **Step 4: Write the sync hook**

Create `src/renderer/lib/document-sync.ts`:

```ts
import { useEffect } from 'react'
import { useGraphStore } from '@/store/graph'

/**
 * Keeps the main process's copy of the open document in step with this window. Local edits are
 * reported upward; documents pushed down are applied without being reported back, so an edit made
 * here cannot echo and an edit made over MCP lands on the canvas.
 */
export function useDocumentSync(): void {
  useEffect(() => {
    let applying = false

    const stopListening = window.api.onDocumentChanged((document) => {
      applying = true
      try {
        useGraphStore.getState().applyRemote(document.graph, document.path, document.dirty)
      } finally {
        applying = false
      }
    })

    const report = (): void => {
      const { graph, path, dirty } = useGraphStore.getState()
      window.api.syncDocument({ graph, path, dirty })
    }

    report()
    const unsubscribe = useGraphStore.subscribe((state, previous) => {
      if (applying) return
      if (state.graph === previous.graph && state.path === previous.path && state.dirty === previous.dirty) return
      report()
    })

    return () => {
      stopListening()
      unsubscribe()
    }
  }, [])
}
```

- [ ] **Step 5: Use it**

In `src/renderer/App.tsx`, import the hook and call it inside `App` beside the existing settings effect:

```tsx
import { useDocumentSync } from '@/lib/document-sync'
```

and inside the component, after the `useEffect` that loads settings:

```tsx
  useDocumentSync()
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass.

Then launch `npx electron-vite dev` and confirm the window still opens with no console errors, and adding a node still works. Kill the process.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "Mirror the open document between the window and the main process

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Remote control settings tab

**Files:**
- Create: `src/renderer/components/RemoteControlTab.tsx`
- Modify: `src/renderer/components/SettingsDialog.tsx`
- Modify: `src/renderer/styles/app.css`

**Interfaces:**
- Consumes: `useUiStore` (`settings`, `updateSettings`), `window.api.getControlStatus`, `window.api.regenerateControlToken`, `describeError`.
- Produces: `RemoteControlTab`.

- [ ] **Step 1: Append the snippet style**

Append to `src/renderer/styles/app.css`:

```css

/* Remote control */
.snippet {
  font-family: var(--mono);
  font-size: 11px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
  margin-bottom: 6px;
}
.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
```

- [ ] **Step 2: Write the tab**

Create `src/renderer/components/RemoteControlTab.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { ControlStatusPayload } from '@shared/ipc'
import { useUiStore } from '@/store/ui'
import { describeError } from '@/lib/errors'

function Snippet({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="field">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label">{label}</span>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => {
            void navigator.clipboard.writeText(text)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="snippet">{text}</div>
    </div>
  )
}

export function RemoteControlTab() {
  const settings = useUiStore((s) => s.settings)
  const updateSettings = useUiStore((s) => s.updateSettings)
  const [status, setStatus] = useState<ControlStatusPayload | null>(null)
  const [showToken, setShowToken] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [port, setPort] = useState(String(settings?.remoteControl.port ?? 4820))

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.api.getControlStatus())
    } catch (err) {
      setError(describeError(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, settings?.remoteControl.enabled, settings?.remoteControl.port])

  useEffect(() => {
    setPort(String(settings?.remoteControl.port ?? 4820))
  }, [settings?.remoteControl.port])

  if (!settings) return null
  const remote = settings.remoteControl

  const setEnabled = async (enabled: boolean): Promise<void> => {
    setError(null)
    try {
      await updateSettings({ remoteControl: { ...remote, enabled } })
    } catch (err) {
      setError(describeError(err))
    }
  }

  const commitPort = async (): Promise<void> => {
    const value = Number(port)
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      setError('Pick a port between 1 and 65535.')
      setPort(String(remote.port))
      return
    }
    if (value === remote.port) return
    setError(null)
    try {
      await updateSettings({ remoteControl: { ...remote, port: value } })
    } catch (err) {
      setError(describeError(err))
    }
  }

  const regenerate = async (): Promise<void> => {
    if (!window.confirm('Replace the token? Any client using the old one stops working.')) return
    setError(null)
    try {
      setStatus(await window.api.regenerateControlToken())
    } catch (err) {
      setError(describeError(err))
    }
  }

  const url = status?.url ?? `http://127.0.0.1:${remote.port}/mcp`
  const token = status?.token ?? ''
  const claudeCommand = `claude mcp add --transport http agent-graph ${url} --header "Authorization: Bearer ${token}"`
  const jsonBlock = JSON.stringify(
    { mcpServers: { 'agent-graph': { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2
  )

  return (
    <>
      <div className="small muted" style={{ marginBottom: 14 }}>
        Lets another agent read and edit the graph in this window, run it, and read the result. It listens on this Mac
        only. Anything running on this Mac that has the token can drive the app.
      </div>

      <div className="status-line">
        <label className="row small">
          <input type="checkbox" checked={remote.enabled} onChange={(e) => void setEnabled(e.target.checked)} /> Enabled
        </label>
        <span className="spacer" />
        <span className="small faint">
          {!remote.enabled ? 'Off' : status?.error ? 'Failed to start' : status?.url ? `Listening on ${status.url}` : 'Starting…'}
        </span>
      </div>

      {status?.error && <div className="error-text" style={{ marginBottom: 12 }}>{status.error}</div>}

      <div className="field">
        <label className="label">Port</label>
        <input
          className="input"
          type="number"
          min={1}
          max={65535}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          onBlur={() => void commitPort()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitPort()
          }}
        />
      </div>

      <div className="field">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">Token</span>
          <div className="row">
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setShowToken(!showToken)}>
              {showToken ? 'Hide' : 'Show'}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => void navigator.clipboard.writeText(token)}>
              Copy
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => void regenerate()}>
              Regenerate
            </button>
          </div>
        </div>
        <div className="snippet">{showToken ? token : '•'.repeat(32)}</div>
      </div>

      <Snippet label="Add it to Claude Code" text={claudeCommand} />
      <Snippet label="Or configure another client" text={jsonBlock} />

      {error && <div className="error-text">{error}</div>}
    </>
  )
}
```

- [ ] **Step 3: Add the tab to the dialog**

In `src/renderer/components/SettingsDialog.tsx`:

- import `RemoteControlTab` from `./RemoteControlTab`
- change the tab type to `type Tab = 'keys' | 'mcp' | 'limits' | 'remote'`
- add `{ id: 'remote', label: 'Remote control' }` to `TABS`
- change the body line to:

```tsx
        <div className="dialog-body">
          {tab === 'keys' ? <KeysTab /> : tab === 'mcp' ? <McpTab /> : tab === 'limits' ? <LimitsTab /> : <RemoteControlTab />}
        </div>
```

- [ ] **Step 4: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass.

Then launch `npx electron-vite dev`, open Settings, and confirm the Remote control tab renders, the enable switch flips, the status line shows a listening URL, and the token and snippets copy. Kill the process afterwards. Report anything you could not verify without clicking.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "Add the Remote control settings tab

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Document it

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the section**

Insert this into `README.md` after the "Using it" section:

```markdown
## Controlling it from another agent

Agent Graph can host an MCP server so Claude Code or another harness can build a graph on the canvas,
run it, and read the result. Open Settings (⌘,), choose **Remote control**, and switch it on. The tab
shows the URL, the token, and a ready-made command:

```bash
claude mcp add --transport http agent-graph http://127.0.0.1:4820/mcp --header "Authorization: Bearer <token>"
```

The server listens on this Mac only and is off until you enable it. Anything running on this Mac that
has the token can drive the app, so treat the token like a password; **Regenerate** replaces it.

Tools it offers:

| Group | Tools |
|---|---|
| Graph | `get_graph`, `new_graph`, `open_graph`, `save_graph`, `set_graph_name`, `validate_graph` |
| Agents | `add_agent`, `update_agent`, `remove_agent`, `set_entry` |
| Edges | `connect`, `update_edge`, `disconnect` |
| Runs | `run_graph`, `stop_run`, `get_run`, `list_runs` |
| Setup | `list_mcp_servers`, `add_mcp_server`, `remove_mcp_server`, `test_mcp_server`, `list_models` |

Agents and edges can be named rather than given by id (`connect` from `Router` to `Writer`, or
`disconnect` the edge `Router->Writer`). API keys are never readable or writable through these tools,
and `list_mcp_servers` hides environment and header values.
```

- [ ] **Step 2: Manual end-to-end verification**

With the app running (`npm run dev`) and remote control enabled, in a separate terminal:

```bash
claude mcp add --transport http agent-graph http://127.0.0.1:4820/mcp --header "Authorization: Bearer <token>"
```

Then ask Claude Code: "Using the agent-graph tools, build a graph with a Router agent that hands off
to a Writer agent, then run it with the input 'write a haiku about bearings'." Confirm the two nodes
appear on the canvas as they are created, the edge is drawn, the run streams in the console, and the
result comes back to Claude Code. Record what you saw in the report.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document the MCP control surface

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
