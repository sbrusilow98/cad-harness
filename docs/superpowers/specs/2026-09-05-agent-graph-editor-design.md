# Agent Graph Editor — Design

Date: 2026-09-05
Status: approved

## Summary

A macOS desktop app for building and running graph-style agentic harnesses. Users lay out agent nodes on a canvas, connect them with edges, give each node a model, instructions, and a tool allowlist, then run the graph with a text input and watch execution stream through the nodes. Agents load tools from Model Context Protocol (MCP) servers. Three model providers are supported: Anthropic (Claude), OpenAI, and Fireworks. The UI is black-and-white, minimal, with a persisted light/dark toggle.

## Decisions already made

- Edges carry a per-edge kind: `handoff` (control flow) or `delegate` (call as tool). Both use the same agent-loop primitive.
- The app both edits and executes graphs.
- Stack: Electron + electron-vite + React 19 + TypeScript 5 + `@xyflow/react` (React Flow) + Zustand + hand-written CSS variables. Tests with Vitest. Packaging with electron-builder (macOS only for now).
- The run engine, MCP clients, and provider calls live in the Electron main process. The renderer is a pure editor and talks to the main process over typed IPC.
- Graphs are plain JSON files. MCP servers are configured at the app level. API keys are stored encrypted via Electron `safeStorage`, never in graph files.

### Alternatives rejected

- Tauri 2: smaller binary, but the MCP client and streaming adapters would have to be Rust or a Node sidecar. More work, no benefit for a local tool.
- Local web server + browser tab: not a desktop app; no native dialogs, window, or keychain.

## Data model

Shared types live in `src/shared/types.ts` and are used by both processes.

```ts
export type ProviderId = 'anthropic' | 'openai' | 'fireworks'

export interface Graph {
  version: 1
  name: string
  entryNodeId: string | null
  nodes: AgentNode[]
  edges: GraphEdge[]
}

export interface AgentNode {
  id: string
  name: string
  position: { x: number; y: number }
  provider: ProviderId
  model: string
  instructions: string            // system prompt
  tools: ToolGrant[]
  temperature?: number
  maxTokens?: number
  maxTurns?: number               // default from settings (25)
}

export interface ToolGrant {
  serverId: string
  names: string[] | '*'
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: 'handoff' | 'delegate'
  description?: string            // feeds the tool description shown to the model
}

export type McpServerConfig = { id: string; name: string } & (
  | { transport: 'stdio'; command: string; args: string[]; env?: Record<string, string> }
  | { transport: 'http'; url: string; headers?: Record<string, string> }
)

export interface Settings {
  theme: 'light' | 'dark'
  mcpServers: McpServerConfig[]
  limits: { maxTurns: number; maxDelegationDepth: number; maxTotalSteps: number }
  recentFiles: string[]
}
```

Defaults: `maxTurns` 25, `maxDelegationDepth` 5, `maxTotalSteps` 200, theme `dark`.

## Runtime semantics

A run starts with one user message at the entry node. Each node execution runs an agent loop:

1. Build the request: system = node instructions; messages = conversation so far for this execution (starts with the incoming user message); tools = the node's tool set.
2. Call the provider with streaming. Text deltas are emitted as events.
3. If the response contains tool calls, execute each (MCP or graph tool), append results, and go to 2. Stop when the model returns no tool calls, when the node's turn limit is reached, or when a `handoff` tool call is made.
4. The node's output is the final assistant text.

### Tool sources for a node

- **MCP tools** granted by `tools[]`. Exposed as `<serverId>__<toolName>`, sanitized to `[A-Za-z0-9_-]`, max 64 characters, with a numeric suffix on collision. A reverse map resolves the exposed name back to server + tool at call time.
- **Delegate tools**: one `delegate_to_<sanitizedChildName>` per outgoing delegate edge, with input `{ task: string }`. Description = edge description, or "Delegate a task to <child name>" if empty. Calling it starts a sub-run at the child with `task` as the user message. The sub-run follows the child's own handoff edges and returns the final output of that sub-flow as the tool result.
- **Handoff tool**: present only when the node has two or more outgoing handoff edges. Name `handoff`, input `{ target: enum of child names, message: string }`. Each option's description comes from its edge description. Calling it ends the current execution immediately and starts the target with `message` as its user message.
- With exactly one outgoing handoff edge, the node's final text is passed automatically to the target after the loop ends.
- With no outgoing handoff edges, the execution's final text is the result of the run (or of the sub-run when delegated).

The user message a handed-off node receives is exactly the handoff message. If the downstream agent needs the original request, the upstream instructions should say to include it. Nothing else is carried implicitly.

### Limits and cycles

Graphs may contain cycles. Termination is guaranteed by three counters: per-execution turn limit, delegation depth, and total steps per run (one step = one provider call). Hitting any limit ends the run with an error event naming the limit.

### Cancellation

`run:stop` aborts an `AbortController` whose signal is passed to every provider request and MCP tool call for that run. The engine emits `run.cancelled` and discards further events.

## Provider abstraction

Neutral message and tool formats in `src/main/providers/types.ts`:

```ts
export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; parts: AssistantPart[] }
  | { role: 'tool'; results: ToolResult[] }
export type AssistantPart =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
export interface ToolResult { callId: string; content: string; isError?: boolean }
export interface ToolDef { name: string; description: string; inputSchema: Record<string, unknown> }

export interface ChatRequest {
  apiKey: string; model: string; system: string; messages: Message[]; tools: ToolDef[]
  temperature?: number; maxTokens?: number; signal: AbortSignal
}
export interface ChatResponse { parts: AssistantPart[]; stopReason: 'end' | 'tool_use' | 'max_tokens' }

export interface ChatProvider {
  id: ProviderId
  listModels(apiKey: string, signal?: AbortSignal): Promise<string[]>
  chat(req: ChatRequest, onTextDelta: (text: string) => void): Promise<ChatResponse>
}
```

Two implementations:

- `anthropic.ts` using `@anthropic-ai/sdk` streaming Messages API.
- `openai-compatible.ts` using the `openai` package with Chat Completions streaming. Instantiated twice: OpenAI (default base URL) and Fireworks (`https://api.fireworks.ai/inference/v1`).

Conversion between neutral and provider formats is done by pure, unit-tested functions. Model lists are fetched from each provider's models endpoint when a key exists; on failure or no key, a static fallback list is used. The model field in the UI is a combo box that accepts free text.

Static fallbacks: Anthropic `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`; OpenAI `gpt-5`, `gpt-5-mini`, `gpt-4.1`; Fireworks `accounts/fireworks/models/llama-v3p3-70b-instruct`, `accounts/fireworks/models/deepseek-v3`, `accounts/fireworks/models/qwen3-235b-a22b`. The Anthropic adapter is written after consulting the `claude-api` skill for current API details.

## MCP integration

`src/main/mcp/registry.ts` owns one `Client` from `@modelcontextprotocol/sdk` per configured server. Transports: `StdioClientTransport` (command, args, env merged over `process.env`) and `StreamableHTTPClientTransport` (url, headers). Connections open lazily on first `listTools` or `callTool` and are reused for the app session; a failed connection is retried on next use. `mcp:test` connects with a fresh client, lists tools, and disconnects. All child processes are killed on app quit.

## IPC surface

Defined in `src/shared/ipc.ts` as channel names and a typed `Api` interface exposed by the preload script on `window.api`.

Renderer → main (invoke):
- `graph:open()` → `{ path, graph } | null`
- `graph:save(graph, path | null)` → `path | null` (null when the user cancels Save As)
- `settings:get()` → `Settings`; `settings:update(patch)` → `Settings`
- `secrets:set(provider, key)`; `secrets:has(provider)` → `boolean`; `secrets:clear(provider)`. The key is never sent back to the renderer.
- `providers:listModels(provider)` → `{ models: string[]; source: 'api' | 'fallback' }`
- `mcp:test(config)` → `{ ok: true; tools: { name; description }[] } | { ok: false; error }`
- `mcp:tools(serverId)` → same shape, using the shared client
- `run:start({ graph, input })` → `runId`; `run:stop(runId)`

Main → renderer (send): `run:event` with a `RunEvent` payload:

```ts
export type RunEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'node.started'; runId: string; executionId: string; nodeId: string; parentExecutionId: string | null; input: string; depth: number }
  | { type: 'node.text'; runId: string; executionId: string; delta: string }
  | { type: 'node.tool.call'; runId: string; executionId: string; callId: string; name: string; args: unknown }
  | { type: 'node.tool.result'; runId: string; executionId: string; callId: string; content: string; isError: boolean }
  | { type: 'node.finished'; runId: string; executionId: string; output: string }
  | { type: 'node.error'; runId: string; executionId: string; error: string }
  | { type: 'edge.traversed'; runId: string; fromExecutionId: string; edgeId: string; kind: 'handoff' | 'delegate'; message: string }
  | { type: 'run.finished'; runId: string; output: string }
  | { type: 'run.error'; runId: string; error: string }
  | { type: 'run.cancelled'; runId: string }
```

## UI

Layout: top bar (40px), canvas filling the remaining space, inspector docked right (320px, shown when something is selected), run console docked bottom (resizable, opens on first run, collapsible).

- **Top bar**: editable graph name, Open, Save (Cmd+S; Save As when no path), Run, theme toggle, Settings. A dot next to the name marks unsaved changes.
- **Canvas** (React Flow): custom node card showing name, provider · model, tool count, and an ENTRY badge. Handoff edges solid, delegate edges dashed, with an optional label from the description. Double-click empty canvas to add a node at that point. Drag from a handle to connect (defaults to handoff). Select + Delete/Backspace removes nodes or edges. Right-click an edge for Flip kind / Delete. A node context menu offers Set as entry / Duplicate / Delete. Standard pan, zoom, minimap off, dotted background.
- **Inspector, node**: name, provider select, model combo box (fetched list + free text), instructions textarea (monospace, grows), entry toggle, temperature and max tokens (optional numeric), max turns, and a tool section listing every configured MCP server with a per-server "all tools" switch and, when expanded, a checklist of tool names with descriptions on hover. Servers whose tool list can't be fetched show an inline error and a Retry.
- **Inspector, edge**: kind (segmented control), description.
- **Run console**: input textarea, Run (Cmd+Enter) and Stop. Below it a timeline: one block per node execution, indented by delegation depth, with the node name, streamed text, collapsible tool call rows (name, args, result), and edge markers ("→ handoff to Writer", "↳ delegated to Researcher"). The final output is shown at the end. Errors render inline in the block. The active execution's node pulses on the canvas; finished nodes get a subtle check, errored nodes a subtle mark, all cleared on the next run.
- **Settings dialog**: tabs "API keys" (three password fields with Save/Clear and a "configured" indicator) and "MCP servers" (list; add/edit form with name, transport, command/args/env or url/headers; Test button showing the tool list or the error) and "Limits".
- **Theme**: `:root[data-theme=light|dark]` variable sets. Only neutrals: background, surface, border, text, muted text, and an inverted pair for primary buttons. State uses opacity and weight, not hue. Fonts: system UI, monospace for instructions and console.

## Persistence

- Graph files: JSON with a `.agentgraph.json` suffix, via native dialogs. The renderer tracks `path` and `dirty`. Closing the window with unsaved changes prompts.
- Settings: `settings.json` in `app.getPath('userData')`, written atomically on every update.
- Secrets: `secrets.bin` in userData, a JSON map encrypted with `safeStorage.encryptString`. If `safeStorage.isEncryptionAvailable()` is false, the app refuses to store keys and says why.

## Errors

- Provider failures (auth, rate limit, network) end the execution with `node.error` and the run with `run.error`, with the provider's message.
- MCP tool errors are returned to the model as `isError` results so it can adapt; the console shows them.
- A graph referencing an MCP server id that no longer exists shows a warning badge on affected nodes; running skips those grants with a console warning.
- Validation before run: an entry node must exist; every edge must reference existing nodes; a node must not have two outgoing edges to the same target of the same kind. Failures are shown in the console without starting a run.

## Testing

Vitest, run with `npm test`.

- `runtime/engine.test.ts` with a fake provider (scripted responses) and fake tool executor: single auto-handoff; routed handoff via the tool; delegation returning a result to the parent; delegate sub-run that itself hands off; turn, depth, and total-step limits terminating a cyclic graph; cancellation mid-run; event order.
- `runtime/graph-tools.test.ts`: tool set construction for a node (names, descriptions, enum for handoff targets).
- `runtime/validate.test.ts`.
- `mcp/naming.test.ts`: sanitization, truncation, collision suffixing, reverse lookup.
- `providers/anthropic.test.ts` and `providers/openai-compatible.test.ts`: neutral ↔ provider conversion in both directions, including tool calls and tool results.
- `renderer/store/graph.test.ts`: add/remove/connect/flip/setEntry/dirty tracking.

The UI is verified by launching the app.

## Out of scope for this version

Non-MCP built-in tools, image or file inputs, memory across runs, nested subgraph nodes, undo/redo, Windows and Linux packaging, auto-layout. The tool grant type and single node type are designed so built-in tools and new node kinds can be added without changing the file format's version.

## File layout

```
package.json  tsconfig.json  tsconfig.node.json  tsconfig.web.json
electron.vite.config.ts  electron-builder.yml  vitest.config.ts
src/shared/        types.ts  ipc.ts  events.ts
src/main/          index.ts  ipc.ts  settings.ts  secrets.ts  graph-files.ts
src/main/mcp/      registry.ts  naming.ts
src/main/providers/ types.ts  anthropic.ts  openai-compatible.ts  index.ts  fallback-models.ts
src/main/runtime/  engine.ts  graph-tools.ts  validate.ts
src/preload/       index.ts
src/renderer/      index.html  main.tsx  App.tsx  styles/theme.css  styles/app.css
src/renderer/store/      graph.ts  ui.ts  run.ts
src/renderer/components/ TopBar.tsx  Canvas.tsx  AgentNodeCard.tsx  GraphEdgeView.tsx
                         Inspector.tsx  NodeInspector.tsx  EdgeInspector.tsx  ToolPicker.tsx
                         RunConsole.tsx  SettingsDialog.tsx  ModelCombo.tsx
```

## Deviations recorded during implementation

These were chosen deliberately while building and reviewing the branch; treat them as the current contract.

- Exposed MCP tool names use the server **name** as the prefix (`FreeCAD__create_object`), not the server id. Names read better to a model, and grants store raw tool names so renaming a server does not break a graph. Collisions still get numeric suffixes.
- `StopReason` includes `refusal`; the engine treats it as an execution error.
- `RunEvent` includes `run.warning` (per-run, de-duplicated) for MCP listing problems such as unconfigured or unreachable servers. MCP tool listings are cached per run, so a cyclic graph lists each server once.
- A delegate call with a missing or empty `task` does not run the child; the model receives an `isError` tool result saying the argument is required. An empty handoff message is replaced by `(no output)` so providers never receive an empty user message.
- Handoff target labels are trimmed, and lookups fall back to a trimmed, case-insensitive match.
- Per-node `maxTurns` and `maxTokens` are clamped to at least 1 at run time, and out-of-range values are dropped when a file is loaded.
- The top bar has a New action (⌘N) in addition to Open and Save. Opening a file fits the view to the loaded graph.
- The unsaved-changes prompt on close is shown by the main process (`will-prevent-unload` plus a native message box) because Chromium suppresses `window.confirm` inside `beforeunload`.
- The top-bar Run button always opens the console; with an empty input it focuses the input and shows a hint instead of doing nothing.
