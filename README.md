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
