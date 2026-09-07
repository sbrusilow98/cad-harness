# Agent Graph

A macOS desktop app for building and running graph-style agentic harnesses. Lay out agent nodes on a canvas, give each one a model, instructions, and MCP tools, connect them with handoff or delegate edges, and run the graph with a live streaming console.

## Features

- Agent nodes with a provider (Anthropic, OpenAI, Fireworks), model, system instructions, and a per-server MCP tool allowlist.
- Two edge kinds: **handoff** (solid) passes control and a message to the next agent; **delegate** (dashed) lets an agent call another as a tool and get its result back.
- MCP servers over stdio (local commands) or streamable HTTP, configured once and shared by every graph.
- Live run console with streamed text, collapsible tool calls, and handoff markers; the active node pulses on the canvas.
- Light and dark themes in pure black, white, and gray.
- Graphs are plain JSON files. API keys live encrypted in the system keychain.

## Setup

```bash
npm install
npm run dev
```

Open Settings (⌘,) to add API keys and MCP servers.

## Using it

1. Double-click the canvas to add an agent. The first one becomes the entry node.
2. Select a node to edit its name, provider, model, instructions, and tools in the right panel.
3. Drag from a node's right handle to another node's left handle to connect them. Right-click an edge (or use the inspector) to switch between handoff and delegate, and give it a description: that description is what the model reads when deciding to use the route.
4. Press Run, type a message, and press ⌘↩.

Runtime rules:

- A node with exactly one outgoing handoff edge passes its final text to that target automatically.
- A node with two or more handoff edges gets a `handoff` tool and chooses the target itself.
- Each delegate edge becomes a `delegate_to_<name>` tool. The child runs (following its own handoffs) and its final output returns as the tool result.
- Runs stop at the per-agent turn limit, the delegation depth limit, or the total step limit (Settings → Limits), so cycles always terminate.

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

## Shortcuts

| Keys | Action |
|---|---|
| ⌘N / ⌘O / ⌘S / ⇧⌘S | New / Open / Save / Save As |
| ⌘J | Toggle the run console |
| ⌘↩ | Run (in the console input) |
| ⌘, | Settings |
| Backspace | Delete the selected node or edge |

## Development

```bash
npm test          # unit tests (Vitest)
npm run typecheck # tsc for main, preload, shared, renderer
npm run build     # production bundles in out/
npm run package   # unsigned macOS app and DMG in dist/
```

Layout: `src/main` (Electron main: run engine, MCP clients, providers, persistence), `src/preload` (IPC bridge), `src/renderer` (React editor), `src/shared` (graph format, events, IPC contract). Design notes live in `docs/superpowers/specs/`.
