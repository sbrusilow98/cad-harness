# MCP Control Surface — Design

Date: 2026-09-07
Status: approved

## Summary

Agent Graph becomes controllable by an outside agent. The app hosts a Model Context Protocol (MCP)
server on loopback while it is running, so Claude Code, Claude Desktop, or another harness can build
a graph on the canvas you are watching, run it, and read the result.

Three capability groups, all approved:

1. **Edit the live graph** — add, update, connect, and remove agents in the document that is open in
   the window; create, open, and save graph files.
2. **Run graphs and read results** — start a run, stop it, and read its transcript and final output.
   The run appears in the app's own console as it happens.
3. **Manage MCP servers and models** — list, add, remove, and test the MCP servers that agents draw
   tools from, and list the models a provider offers. API keys are never readable or writable
   through this surface.

## Decisions already made

- **Transport: streamable HTTP on `127.0.0.1`**, default port `4820`, path `/mcp`. The MCP SDK ships
  a Node server transport for it, and `claude mcp add --transport http` connects in one command.
  Clients that speak only stdio use the standard `mcp-remote` bridge; the app ships no second binary.
- **Off by default.** The user enables it in Settings and the app shows the connection details.
- **Bearer token auth**, plus the SDK's DNS-rebinding protection, so a web page cannot reach it.
- Rejected: a stdio bridge executable (a GUI app is a poor stdio child, and `mcp-remote` already
  exists); a headless CLI (it would not control the window you are looking at, which is the point).

## Architecture

The main process already owns the run engine, MCP clients, settings, and secrets. Two of its
responsibilities become explicit services so both the IPC layer and the MCP server can use them,
then the MCP server sits on top.

```
                 ┌──────────── Electron main ────────────┐
 MCP client ──▶  │  http (loopback) → McpServer → tools   │
 (Claude Code)   │        │                               │
                 │        ▼                               │
                 │  DocumentService     RunService        │
                 │        │  ▲              │  ▲          │
                 └────────┼──┼──────────────┼──┼──────────┘
                          ▼  │              ▼  │
                        IPC  │            IPC  │
                          ▼  │              ▼  │
                 ┌──────── renderer (canvas, console) ────┐
```

### DocumentService

Main holds a mirror of the open document: `{ graph, path, dirty, revision }`. The renderer remains
where a human edits, and reports every local change; the mirror is what MCP reads and writes.

- `get(): OpenDocument`
- `syncFromRenderer(doc)` — the renderer's own edits update the mirror and bump the revision. No push
  back, so a local edit cannot echo.
- `mutate(fn: (graph: Graph) => Graph | MutationError)` — MCP edits. Validates the result, bumps the
  revision, marks the document dirty, and pushes it to every window.
- `replace(graph, path, dirty)` — for `new_graph` and `open_graph`.

The renderer applies a pushed document through a new store action that suppresses its own sync while
applying, so there is no feedback loop. The canvas already rebuilds its view from the model and
preserves selection and in-progress drags, so a remote edit appears in place while the user watches.
Node positions travel in the graph itself, so an agent added remotely lands where the tool put it.

When no window is open the mirror is simply the document; a window that opens afterwards adopts it.

### RunService

Replaces the `Map<string, AbortController>` currently inline in the IPC layer.

- `start({ graph, input }): string` — returns a run id; broadcasts run events to **every** window, so
  a run started over MCP streams into the app's console.
- `stop(runId)`, `get(runId)`, `list()`, `wait(runId, timeoutMs)`.
- Keeps a transcript per run, built by feeding run events through the same pure reducer the renderer
  uses. `applyRunEvent`, `initialRunState`, and the view types move from `src/renderer/store/run.ts`
  to `src/shared/run-transcript.ts`; the renderer store and the RunService both import them, so the
  transcript has one shape and one implementation.
- Bounded memory: the most recent 50 runs; per execution, streamed text is capped at 100,000
  characters and each tool result at 20,000, truncated with a marker when exceeded.

### MCP server

`src/main/control/` holds the whole surface, with a `ControlDeps` object (document, runs, settings,
secrets, mcp registry, model lister) injected so every tool is testable without Electron.

- `buildControlServer(deps): McpServer` registers the tools below with `zod` schemas.
- The HTTP layer runs in **stateless** mode (`sessionIdGenerator: undefined`,
  `enableJsonResponse: true`): each request gets a fresh `McpServer` and transport, so there is no
  session bookkeeping. Server-initiated notifications are out of scope, which is what statelessness
  costs.
- `enableDnsRebindingProtection: true` with `allowedHosts` limited to `127.0.0.1` and `localhost` on
  the configured port.

## Tools

Every tool returns JSON text. Agents and edges accept either an id or a unique name; an ambiguous
name is an error that lists the candidates.

**Document**

| Tool | Input | Returns |
|---|---|---|
| `get_graph` | — | the document: name, path, dirty, entry, agents, edges |
| `new_graph` | `name?` | the new document |
| `open_graph` | `path` | the loaded document |
| `save_graph` | `path?` | the path written; errors when the document has no path and none is given |
| `set_graph_name` | `name` | the document |
| `add_agent` | `name`, `provider?`, `model?`, `instructions?`, `tools?`, `position?`, `entry?` | the new agent |
| `update_agent` | `agent`, and any of `name`, `provider`, `model`, `instructions`, `tools`, `position`, `temperature`, `maxTokens`, `maxTurns` | the updated agent |
| `remove_agent` | `agent` | removed id and the edges dropped with it |
| `set_entry` | `agent` | the document |
| `connect` | `from`, `to`, `kind` (`handoff`\|`delegate`), `description?` | the new edge |
| `update_edge` | `edge`, `kind?`, `description?` | the updated edge |
| `disconnect` | `edge` | removed id |
| `validate_graph` | — | issues from the existing `validateGraph`, including unknown MCP servers |

`add_agent` defaults to the Anthropic default model and auto-places the node in a free spot when no
position is given, so an agent building a graph never has to think about coordinates. The first
agent added to an empty graph becomes the entry, matching the canvas.

**Runs**

| Tool | Input | Returns |
|---|---|---|
| `run_graph` | `input`, `wait?` (default true), `timeoutSeconds?` (default 300) | run id, status, output, and the transcript |
| `stop_run` | `runId` | status |
| `get_run` | `runId` | the run with its transcript |
| `list_runs` | `limit?` | recent runs: id, status, input, output, timestamps |

`run_graph` runs the document currently open. Validation errors come back as a tool error rather than
a failed run. With `wait: false` it returns the id immediately.

**Settings**

| Tool | Input | Returns |
|---|---|---|
| `list_mcp_servers` | — | configured servers, without env values or header values |
| `add_mcp_server` | `name`, `transport`, `command`/`args`/`env` or `url`/`headers` | the server, after a successful connection test |
| `remove_mcp_server` | `server` | removed id |
| `test_mcp_server` | `server` | the tools the server exposes |
| `list_models` | `provider` | model ids and whether they came from the API or the built-in list |

No tool reads, writes, or reports an API key. `list_mcp_servers` redacts env and header **values**
because those often hold credentials; names are kept so a client can see what is configured.

**Resources**

- `agentgraph://document` — the same payload as `get_graph`.
- `agentgraph://runs/{runId}` — the same payload as `get_run`.

## Settings and UI

`Settings` gains `remoteControl: { enabled: boolean; port: number }` (default disabled, port 4820).
The token is 32 random bytes, hex encoded, stored in the encrypted secret store under
`remoteControlToken`, never in `settings.json`.

A fourth Settings tab, **Remote control**:

- An enable switch and a port field.
- A status line: listening on the URL, starting, disabled, or the bind error (for example a port
  already in use).
- The token, masked, with Show, Copy, and Regenerate. Regenerating breaks existing clients and the
  button says so.
- Two copy-able snippets, filled in with the live port and token: the `claude mcp add --transport
  http` command, and an equivalent JSON block for other clients.
- One line naming the risk: anything running on this Mac that has the token can drive the app.

Toggling the switch, changing the port, or regenerating the token restarts the listener in place.

## Errors

- Tool failures return an MCP error result carrying a plain sentence: unknown agent or edge, an
  ambiguous name with its candidates, a graph that would become invalid, a save with no path, an
  unknown run id, a run that timed out while waiting (with the id, so the caller can poll).
- A mutation that would produce an invalid graph is rejected before it is applied, so the canvas
  never shows a broken state.
- A listener that cannot bind leaves the app fully usable and reports the reason in the tab.
- `run_graph` while a run is in flight is allowed; runs are independent.

## Testing

- `DocumentService`: mutation, revision bumps, name resolution including the ambiguous case,
  rejection of an invalid result, and that a renderer sync does not push back.
- `RunService`: start and wait, timeout, stop, transcript assembly against a fake engine, the 50-run
  cap, and text truncation.
- `run-transcript`: the existing reducer tests move with the module.
- Tools: driven end to end through the SDK's in-memory transport against fake dependencies, at least
  one test per tool, asserting both the success payload and the error message.
- HTTP: start the listener on port 0, connect with the SDK client, and assert that a missing or wrong
  token gives 401 while the right one lists tools.
- Manual: `claude mcp add`, then ask Claude Code to build and run a two-agent graph with the window
  open.

## Out of scope

Change notifications to connected clients (statelessness precludes them), MCP prompts, access from
other machines, undo, and controlling more than one window.

## Dependency change

`zod` moves from devDependencies to dependencies; tool schemas need it at runtime.

## File layout

```
src/shared/run-transcript.ts            reducer + view types (moved out of the renderer store)
src/main/document-service.ts            the mirrored open document
src/main/run-service.ts                 runs, transcripts, broadcast
src/main/control/server.ts              buildControlServer(deps)
src/main/control/tools-document.ts      document tools
src/main/control/tools-runs.ts          run tools
src/main/control/tools-settings.ts      server and model tools
src/main/control/resolve.ts             id-or-name resolution, shared error messages
src/main/control/http.ts                loopback listener, auth, lifecycle
src/renderer/components/RemoteControlTab.tsx   the Settings tab
```
