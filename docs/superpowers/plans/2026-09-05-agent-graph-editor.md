# Agent Graph Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A macOS Electron app that edits and runs graph-style agentic harnesses: agent nodes with a model, instructions, and MCP tool grants, connected by handoff or delegate edges, executed against Anthropic, OpenAI, or Fireworks with a live streaming console.

**Architecture:** Electron main process owns everything with side effects: the run engine, MCP clients (child processes / HTTP), provider HTTP streaming, settings, encrypted secrets, and file dialogs. The renderer is a React editor (React Flow canvas, inspector, run console, settings dialog) that talks to main over a typed IPC bridge exposed by the preload script. Shared TypeScript types define the graph file format, IPC contract, and run events.

**Tech Stack:** Electron 44, electron-vite 5 (Vite 7), React 19, TypeScript 5.9, `@xyflow/react` 12, Zustand 5, `@anthropic-ai/sdk` 0.124, `openai` 7, `@modelcontextprotocol/sdk` 1.30, Vitest 5, electron-builder 26.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-agent-graph-editor-design.md`. Read it once before starting any task.
- Package is CommonJS (no `"type": "module"` in package.json). Main and preload build to CommonJS; the renderer is a Vite bundle. Do not add `"type": "module"`.
- Dependencies are already installed and pinned in `package.json`. Do not add new dependencies. `zod` is a devDependency used only in tests.
- Import shared code with the `@shared/*` alias (maps to `src/shared/*`). Renderer code may also use `@/*` for `src/renderer/*`.
- Tool names exposed to models: `[A-Za-z0-9_-]`, max 64 characters.
- Defaults: `maxTurns` 25, `maxDelegationDepth` 5, `maxTotalSteps` 200, theme `dark`, default model for a new node `claude-opus-5` on provider `anthropic`.
- Anthropic requests never send a `thinking` parameter; `temperature` and `max_tokens`-style parameters are sent only when the node sets them explicitly (the newest Claude models reject `temperature`).
- Neutral assistant messages carry `raw` provider content so Anthropic thinking blocks are replayed verbatim on the next turn.
- UI: black, white, and grays only. Two CSS variable sets under `:root` (light) and `:root[data-theme="dark"]`. No third-party CSS except `@xyflow/react/dist/style.css`.
- Every commit uses the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and the identity `-c user.name="Sam Brusilow" -c user.email="sbrusilow1@gmail.com"` if git has no global identity configured.
- Run tests with `npm test` (Vitest, `vitest run`). Run type checks with `npm run typecheck`. Both must pass at the end of every task.

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig*.json`, `electron.vite.config.ts`, `vitest.config.ts`, `electron-builder.yml`, `.gitignore` | Build, test, and packaging configuration |
| `src/shared/types.ts` | Graph file format, settings, provider ids, defaults |
| `src/shared/graph-defaults.ts` | `emptyGraph`, `createAgentNode` factories |
| `src/shared/events.ts` | `RunEvent` union streamed from main to renderer |
| `src/shared/ipc.ts` | IPC channel names, `Api` interface on `window.api`, result types |
| `src/main/index.ts` | App lifecycle, window creation, wiring of stores and IPC |
| `src/main/ipc.ts` | IPC handlers and the run manager (start/stop, event forwarding) |
| `src/main/settings.ts` | `SettingsStore` (settings.json, atomic writes) |
| `src/main/secrets.ts` | `SecretStore` (safeStorage-encrypted API keys) |
| `src/main/graph-files.ts` | Parse and serialize graph files with validation |
| `src/main/mcp/naming.ts` | Tool name sanitization and `ToolNameRegistry` |
| `src/main/mcp/registry.ts` | `McpRegistry`: lazy MCP clients, listTools, callTool, test |
| `src/main/providers/types.ts` | Neutral `Message`, `ToolDef`, `ChatProvider` interfaces |
| `src/main/providers/anthropic.ts` | Anthropic adapter and conversion functions |
| `src/main/providers/openai-compatible.ts` | OpenAI / Fireworks adapter and conversion functions |
| `src/main/providers/fallback-models.ts` | Static model lists |
| `src/main/providers/index.ts` | `getProvider`, `listModelsWithFallback` |
| `src/main/runtime/validate.ts` | `validateGraph` |
| `src/main/runtime/graph-tools.ts` | Builds a node's tool set (MCP, delegate, handoff tools) |
| `src/main/runtime/engine.ts` | `runGraph`: agent loop, handoff, delegation, limits, cancellation |
| `src/preload/index.ts` | `contextBridge` exposing `window.api` |
| `src/renderer/index.html`, `main.tsx`, `App.tsx` | Renderer entry and layout |
| `src/renderer/styles/theme.css`, `app.css` | Theme variables and all component styles |
| `src/renderer/store/graph.ts` | Graph document store (nodes, edges, path, dirty) |
| `src/renderer/store/ui.ts` | Theme, settings, selection, dialogs, model and tool caches |
| `src/renderer/store/run.ts` | `applyRunEvent` reducer and run store |
| `src/renderer/components/TopBar.tsx` | Name, open/save, run, theme, settings |
| `src/renderer/components/Canvas.tsx` | React Flow integration, context menus |
| `src/renderer/components/AgentNodeCard.tsx` | Custom node |
| `src/renderer/components/GraphEdgeView.tsx` | Custom edge |
| `src/renderer/components/Inspector.tsx`, `NodeInspector.tsx`, `EdgeInspector.tsx`, `ToolPicker.tsx`, `ModelCombo.tsx` | Right panel |
| `src/renderer/components/RunConsole.tsx` | Input, run/stop, timeline |
| `src/renderer/components/SettingsDialog.tsx` | API keys, MCP servers, limits |
| `src/renderer/components/ContextMenu.tsx` | Shared context menu |

---

### Task 1: Project scaffold

**Files:**
- Modify: `package.json` (already has scripts and pinned dependencies; verify only)
- Create: `.gitignore`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `electron.vite.config.ts`, `vitest.config.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`

**Interfaces:**
- Produces: a runnable Electron app skeleton, `npm run build`, `npm run typecheck`, `npm test` all working.

- [ ] **Step 1: Verify package.json**

Run: `cat package.json`
Expected: scripts `dev`, `build`, `typecheck`, `test`, `package`; dependencies as listed in the Tech Stack; no `"type": "module"`. If anything differs, fix it to match:

```json
{
  "name": "agent-graph",
  "version": "0.1.0",
  "description": "Visual graph editor and runtime for graph-style agentic harnesses",
  "main": "./out/main/index.js",
  "private": true,
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "package": "electron-vite build && electron-builder --mac"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "0.124.0",
    "@modelcontextprotocol/sdk": "1.30.0",
    "@xyflow/react": "12.11.6",
    "openai": "7.10.0",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "zustand": "5.0.15"
  },
  "devDependencies": {
    "@types/node": "24.10.1",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.7",
    "@vitejs/plugin-react": "5.2.0",
    "electron": "44.2.0",
    "electron-builder": "26.15.3",
    "electron-vite": "5.0.0",
    "typescript": "5.9.3",
    "vite": "7.3.6",
    "vitest": "5.0.0",
    "zod": "4.5.4"
  }
}
```

- [ ] **Step 2: Create config files**

`.gitignore`:
```
node_modules
out
dist
*.log
.DS_Store
```

`tsconfig.json`:
```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "composite": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["electron.vite.config.ts", "vitest.config.ts", "src/main/**/*", "src/preload/**/*", "src/shared/**/*"]
}
```

`tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "composite": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"], "@/*": ["src/renderer/*"] }
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

`electron.vite.config.ts`:
```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { ...shared, '@': resolve(__dirname, 'src/renderer') } }
  }
})
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer')
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true
  }
})
```

- [ ] **Step 3: Create the minimal main, preload, and renderer**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: '#0e0e0e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

`src/preload/index.ts`:
```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('api', {})
```

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Agent Graph</title>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

`src/renderer/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`src/renderer/App.tsx`:
```tsx
export default function App() {
  return <div style={{ padding: 24, fontFamily: 'system-ui' }}>Agent Graph</div>
}
```

- [ ] **Step 4: Verify build, typecheck, and tests run**

Run: `npm run typecheck && npm run build && npm test`
Expected: typecheck prints nothing; build prints `built in` lines for main, preload, renderer and creates `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html`; vitest reports `No test files found` and exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Scaffold Electron + React + Vite project

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Shared types, events, and IPC contract

**Files:**
- Create: `src/shared/types.ts`, `src/shared/graph-defaults.ts`, `src/shared/events.ts`, `src/shared/ipc.ts`
- Test: `src/shared/graph-defaults.test.ts`

**Interfaces:**
- Produces: every type below; later tasks import them by these exact names.

- [ ] **Step 1: Write the failing test**

`src/shared/graph-defaults.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { emptyGraph, createAgentNode } from './graph-defaults'

describe('graph defaults', () => {
  it('creates an empty graph with no entry', () => {
    const g = emptyGraph('Demo')
    expect(g).toEqual({ version: 1, name: 'Demo', entryNodeId: null, nodes: [], edges: [] })
  })

  it('creates an agent node with defaults and a unique id', () => {
    const a = createAgentNode({ x: 10, y: 20 })
    const b = createAgentNode({ x: 0, y: 0 }, { name: 'Writer' })
    expect(a.id).not.toBe(b.id)
    expect(a.position).toEqual({ x: 10, y: 20 })
    expect(a.provider).toBe('anthropic')
    expect(a.model).toBe('claude-opus-5')
    expect(a.instructions).toBe('')
    expect(a.tools).toEqual([])
    expect(b.name).toBe('Writer')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/graph-defaults.test.ts`
Expected: FAIL, cannot find module `./graph-defaults`.

- [ ] **Step 3: Write the shared modules**

`src/shared/types.ts`:
```ts
export type ProviderId = 'anthropic' | 'openai' | 'fireworks'

export const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'fireworks']

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  fireworks: 'Fireworks'
}

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-opus-5',
  openai: 'gpt-5',
  fireworks: 'accounts/fireworks/models/llama-v3p3-70b-instruct'
}

export interface Position {
  x: number
  y: number
}

export interface ToolGrant {
  serverId: string
  names: string[] | '*'
}

export interface AgentNode {
  id: string
  name: string
  position: Position
  provider: ProviderId
  model: string
  instructions: string
  tools: ToolGrant[]
  temperature?: number
  maxTokens?: number
  maxTurns?: number
}

export type EdgeKind = 'handoff' | 'delegate'

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  description?: string
}

export interface Graph {
  version: 1
  name: string
  entryNodeId: string | null
  nodes: AgentNode[]
  edges: GraphEdge[]
}

export type McpServerConfig = { id: string; name: string } & (
  | { transport: 'stdio'; command: string; args: string[]; env?: Record<string, string> }
  | { transport: 'http'; url: string; headers?: Record<string, string> }
)

export interface RunLimits {
  maxTurns: number
  maxDelegationDepth: number
  maxTotalSteps: number
}

export type Theme = 'light' | 'dark'

export interface Settings {
  theme: Theme
  mcpServers: McpServerConfig[]
  limits: RunLimits
  recentFiles: string[]
}

export const DEFAULT_LIMITS: RunLimits = { maxTurns: 25, maxDelegationDepth: 5, maxTotalSteps: 200 }

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  mcpServers: [],
  limits: DEFAULT_LIMITS,
  recentFiles: []
}
```

`src/shared/graph-defaults.ts`:
```ts
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
```

`src/shared/events.ts`:
```ts
import type { EdgeKind } from './types'

export type RunEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'run.warning'; runId: string; message: string }
  | {
      type: 'node.started'
      runId: string
      executionId: string
      nodeId: string
      parentExecutionId: string | null
      input: string
      depth: number
    }
  | { type: 'node.text'; runId: string; executionId: string; delta: string }
  | { type: 'node.tool.call'; runId: string; executionId: string; callId: string; name: string; args: unknown }
  | { type: 'node.tool.result'; runId: string; executionId: string; callId: string; content: string; isError: boolean }
  | { type: 'node.finished'; runId: string; executionId: string; output: string }
  | { type: 'node.error'; runId: string; executionId: string; error: string }
  | {
      type: 'edge.traversed'
      runId: string
      fromExecutionId: string
      edgeId: string
      kind: EdgeKind
      message: string
    }
  | { type: 'run.finished'; runId: string; output: string }
  | { type: 'run.error'; runId: string; error: string }
  | { type: 'run.cancelled'; runId: string }
```

`src/shared/ipc.ts`:
```ts
import type { Graph, McpServerConfig, ProviderId, Settings } from './types'
import type { RunEvent } from './events'

export const IPC = {
  openGraph: 'graph:open',
  saveGraph: 'graph:save',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  setSecret: 'secrets:set',
  hasSecret: 'secrets:has',
  clearSecret: 'secrets:clear',
  listModels: 'providers:listModels',
  testMcp: 'mcp:test',
  listMcpTools: 'mcp:tools',
  startRun: 'run:start',
  stopRun: 'run:stop',
  runEvent: 'run:event'
} as const

export interface McpToolSummary {
  name: string
  description: string
}

export type McpToolListResult = { ok: true; tools: McpToolSummary[] } | { ok: false; error: string }

export interface ModelListResult {
  models: string[]
  source: 'api' | 'fallback'
  error?: string
}

export interface OpenedGraph {
  path: string
  graph: Graph
}

export interface Api {
  openGraph(): Promise<OpenedGraph | null>
  saveGraph(graph: Graph, path: string | null): Promise<string | null>
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  setSecret(provider: ProviderId, key: string): Promise<void>
  hasSecret(provider: ProviderId): Promise<boolean>
  clearSecret(provider: ProviderId): Promise<void>
  listModels(provider: ProviderId): Promise<ModelListResult>
  testMcpServer(config: McpServerConfig): Promise<McpToolListResult>
  listMcpTools(serverId: string): Promise<McpToolListResult>
  startRun(graph: Graph, input: string): Promise<string>
  stopRun(runId: string): Promise<void>
  onRunEvent(listener: (event: RunEvent) => void): () => void
}

declare global {
  interface Window {
    api: Api
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/shared/graph-defaults.test.ts && npm run typecheck`
Expected: 2 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared
git commit -m "Add shared graph types, run events, and IPC contract

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: MCP tool naming

**Files:**
- Create: `src/main/mcp/naming.ts`
- Test: `src/main/mcp/naming.test.ts`

**Interfaces:**
- Produces: `sanitizeToolName(raw: string): string`, `buildExposedName(prefix: string, toolName: string, maxLength?: number): string`, `uniqueName(base: string, taken: (name: string) => boolean, maxLength?: number): string`, `interface ToolRef { serverId: string; toolName: string }`, `class ToolNameRegistry { register(prefix: string, ref: ToolRef): string; resolve(exposed: string): ToolRef | undefined }`, `MAX_TOOL_NAME_LENGTH = 64`.

- [ ] **Step 1: Write the failing test**

`src/main/mcp/naming.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { sanitizeToolName, buildExposedName, uniqueName, ToolNameRegistry } from './naming'

describe('sanitizeToolName', () => {
  it('replaces invalid characters with underscores and trims them', () => {
    expect(sanitizeToolName('My Server (local)')).toBe('My_Server_local')
    expect(sanitizeToolName('  ok-name_1 ')).toBe('ok-name_1')
  })
  it('falls back to "tool" when nothing is left', () => {
    expect(sanitizeToolName('***')).toBe('tool')
  })
})

describe('buildExposedName', () => {
  it('joins prefix and tool with a double underscore', () => {
    expect(buildExposedName('freecad', 'create_object')).toBe('freecad__create_object')
  })
  it('trims the prefix to fit the length limit but keeps the tool name', () => {
    const name = buildExposedName('a'.repeat(80), 'execute_code')
    expect(name.length).toBe(64)
    expect(name.endsWith('__execute_code')).toBe(true)
  })
  it('truncates the tool name when even that is too long', () => {
    const name = buildExposedName('p', 'x'.repeat(100))
    expect(name.length).toBe(64)
  })
})

describe('uniqueName', () => {
  it('returns the base when free', () => {
    expect(uniqueName('handoff', () => false)).toBe('handoff')
  })
  it('appends numeric suffixes on collision', () => {
    const taken = new Set(['a', 'a_2'])
    expect(uniqueName('a', (n) => taken.has(n))).toBe('a_3')
  })
  it('keeps suffixed names within the limit', () => {
    const base = 'b'.repeat(64)
    const name = uniqueName(base, (n) => n === base)
    expect(name.length).toBe(64)
    expect(name.endsWith('_2')).toBe(true)
  })
})

describe('ToolNameRegistry', () => {
  it('registers, dedupes, and resolves names', () => {
    const reg = new ToolNameRegistry()
    const a = reg.register('FreeCAD', { serverId: 's1', toolName: 'run' })
    const again = reg.register('FreeCAD', { serverId: 's1', toolName: 'run' })
    const b = reg.register('FreeCAD', { serverId: 's2', toolName: 'run' })
    expect(a).toBe('FreeCAD__run')
    expect(again).toBe(a)
    expect(b).toBe('FreeCAD__run_2')
    expect(reg.resolve(a)).toEqual({ serverId: 's1', toolName: 'run' })
    expect(reg.resolve(b)).toEqual({ serverId: 's2', toolName: 'run' })
    expect(reg.resolve('nope')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/mcp/naming.test.ts`
Expected: FAIL, cannot find module `./naming`.

- [ ] **Step 3: Implement**

`src/main/mcp/naming.ts`:
```ts
export const MAX_TOOL_NAME_LENGTH = 64

const INVALID_CHARS = /[^A-Za-z0-9_-]+/g

export interface ToolRef {
  serverId: string
  toolName: string
}

export function sanitizeToolName(raw: string): string {
  const cleaned = raw.trim().replace(INVALID_CHARS, '_').replace(/^_+|_+$/g, '')
  return cleaned.length > 0 ? cleaned : 'tool'
}

export function buildExposedName(prefix: string, toolName: string, maxLength = MAX_TOOL_NAME_LENGTH): string {
  const tool = sanitizeToolName(toolName)
  const pre = sanitizeToolName(prefix)
  const full = `${pre}__${tool}`
  if (full.length <= maxLength) return full
  const room = maxLength - tool.length - 2
  if (room >= 3) return `${pre.slice(0, room)}__${tool}`
  return tool.slice(0, maxLength)
}

export function uniqueName(
  base: string,
  taken: (name: string) => boolean,
  maxLength = MAX_TOOL_NAME_LENGTH
): string {
  if (!taken(base)) return base
  for (let i = 2; ; i++) {
    const suffix = `_${i}`
    const candidate = base.slice(0, maxLength - suffix.length) + suffix
    if (!taken(candidate)) return candidate
  }
}

export class ToolNameRegistry {
  private byExposed = new Map<string, ToolRef>()
  private byKey = new Map<string, string>()

  register(prefix: string, ref: ToolRef): string {
    const key = `${ref.serverId}::${ref.toolName}`
    const existing = this.byKey.get(key)
    if (existing) return existing
    const name = uniqueName(buildExposedName(prefix, ref.toolName), (n) => this.byExposed.has(n))
    this.byExposed.set(name, { ...ref })
    this.byKey.set(key, name)
    return name
  }

  resolve(exposed: string): ToolRef | undefined {
    return this.byExposed.get(exposed)
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/main/mcp/naming.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/naming.ts src/main/mcp/naming.test.ts
git commit -m "Add MCP tool name sanitization and registry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Graph validation

**Files:**
- Create: `src/main/runtime/validate.ts`
- Test: `src/main/runtime/validate.test.ts`

**Interfaces:**
- Consumes: `Graph` from `@shared/types`.
- Produces: `interface ValidationIssue { level: 'error' | 'warning'; message: string; nodeId?: string; edgeId?: string }`, `validateGraph(graph: Graph, knownServerIds?: Set<string>): ValidationIssue[]`, `hasErrors(issues: ValidationIssue[]): boolean`.

- [ ] **Step 1: Write the failing test**

`src/main/runtime/validate.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { validateGraph, hasErrors } from './validate'
import { emptyGraph, createAgentNode } from '@shared/graph-defaults'
import type { Graph } from '@shared/types'

function twoNodeGraph(): Graph {
  const g = emptyGraph()
  const a = createAgentNode({ x: 0, y: 0 }, { id: 'a', name: 'A' })
  const b = createAgentNode({ x: 0, y: 0 }, { id: 'b', name: 'B' })
  g.nodes.push(a, b)
  g.edges.push({ id: 'e1', source: 'a', target: 'b', kind: 'handoff' })
  g.entryNodeId = 'a'
  return g
}

describe('validateGraph', () => {
  it('accepts a valid graph', () => {
    const issues = validateGraph(twoNodeGraph())
    expect(issues).toEqual([])
    expect(hasErrors(issues)).toBe(false)
  })

  it('requires an entry node', () => {
    const g = twoNodeGraph()
    g.entryNodeId = null
    const issues = validateGraph(g)
    expect(issues.some((i) => i.level === 'error' && /entry/i.test(i.message))).toBe(true)
    expect(hasErrors(issues)).toBe(true)
  })

  it('flags an entry that points at a missing node', () => {
    const g = twoNodeGraph()
    g.entryNodeId = 'zzz'
    expect(hasErrors(validateGraph(g))).toBe(true)
  })

  it('flags edges that reference missing nodes', () => {
    const g = twoNodeGraph()
    g.edges.push({ id: 'e2', source: 'a', target: 'missing', kind: 'delegate' })
    const issues = validateGraph(g)
    expect(issues.find((i) => i.edgeId === 'e2')?.level).toBe('error')
  })

  it('flags duplicate edges of the same kind between the same nodes', () => {
    const g = twoNodeGraph()
    g.edges.push({ id: 'e2', source: 'a', target: 'b', kind: 'handoff' })
    expect(validateGraph(g).find((i) => i.edgeId === 'e2')?.level).toBe('error')
  })

  it('allows a handoff and a delegate edge between the same nodes', () => {
    const g = twoNodeGraph()
    g.edges.push({ id: 'e2', source: 'a', target: 'b', kind: 'delegate' })
    expect(hasErrors(validateGraph(g))).toBe(false)
  })

  it('flags empty names and models', () => {
    const g = twoNodeGraph()
    g.nodes[1].name = '  '
    g.nodes[1].model = ''
    const issues = validateGraph(g).filter((i) => i.nodeId === 'b')
    expect(issues).toHaveLength(2)
    expect(issues.every((i) => i.level === 'error')).toBe(true)
  })

  it('warns about unreachable nodes', () => {
    const g = twoNodeGraph()
    g.nodes.push(createAgentNode({ x: 0, y: 0 }, { id: 'c', name: 'C' }))
    const issues = validateGraph(g)
    expect(issues).toEqual([{ level: 'warning', message: '"C" is not reachable from the entry node.', nodeId: 'c' }])
  })

  it('warns about unknown MCP servers when a server list is given', () => {
    const g = twoNodeGraph()
    g.nodes[0].tools = [{ serverId: 'gone', names: '*' }]
    const issues = validateGraph(g, new Set(['other']))
    expect(issues.find((i) => i.nodeId === 'a')?.level).toBe('warning')
    expect(validateGraph(g)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/runtime/validate.test.ts`
Expected: FAIL, cannot find module `./validate`.

- [ ] **Step 3: Implement**

`src/main/runtime/validate.ts`:
```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/main/runtime/validate.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/runtime/validate.ts src/main/runtime/validate.test.ts
git commit -m "Add graph validation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Provider types and node tool sets

**Files:**
- Create: `src/main/providers/types.ts`, `src/main/runtime/graph-tools.ts`
- Test: `src/main/runtime/graph-tools.test.ts`

**Interfaces:**
- Consumes: `ToolNameRegistry`, `sanitizeToolName`, `uniqueName`, `ToolRef` from `../mcp/naming`.
- Produces (providers/types.ts): `Message`, `AssistantPart`, `TextPart`, `ToolCallPart`, `ToolResult`, `ToolDef`, `ChatRequest`, `ChatResponse`, `StopReason`, `ChatProvider`, `RawAssistantContent`, `textOf(parts)`, `toolCallsOf(parts)`.
- Produces (graph-tools.ts): `HANDOFF_TOOL = 'handoff'`, `interface McpToolInfo { serverId: string; serverName: string; name: string; description: string; inputSchema: Record<string, unknown> }`, `interface NodeToolSet { defs: ToolDef[]; mcp: Map<string, ToolRef>; delegates: Map<string, GraphEdge>; handoffTargets: Map<string, GraphEdge> | null; autoHandoff: GraphEdge | null }`, `buildNodeToolSet(graph: Graph, node: AgentNode, available: McpToolInfo[], registry: ToolNameRegistry): NodeToolSet`.

- [ ] **Step 1: Write the provider types (pure types, no test)**

`src/main/providers/types.ts`:
```ts
import type { ProviderId } from '@shared/types'

export interface TextPart {
  type: 'text'
  text: string
}

export interface ToolCallPart {
  type: 'tool_call'
  id: string
  name: string
  args: Record<string, unknown>
}

export type AssistantPart = TextPart | ToolCallPart

export interface ToolResult {
  callId: string
  content: string
  isError?: boolean
}

/** Provider-native assistant content, replayed verbatim on the next turn of the same provider. */
export interface RawAssistantContent {
  provider: ProviderId
  content: unknown
}

export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; parts: AssistantPart[]; raw?: RawAssistantContent }
  | { role: 'tool'; results: ToolResult[] }

export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal'

export interface ChatRequest {
  apiKey: string
  model: string
  system: string
  messages: Message[]
  tools: ToolDef[]
  temperature?: number
  maxTokens?: number
  signal: AbortSignal
}

export interface ChatResponse {
  parts: AssistantPart[]
  stopReason: StopReason
  raw?: RawAssistantContent
}

export interface ChatProvider {
  id: ProviderId
  listModels(apiKey: string, signal?: AbortSignal): Promise<string[]>
  chat(req: ChatRequest, onTextDelta: (text: string) => void): Promise<ChatResponse>
}

export function textOf(parts: AssistantPart[]): string {
  return parts
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

export function toolCallsOf(parts: AssistantPart[]): ToolCallPart[] {
  return parts.filter((p): p is ToolCallPart => p.type === 'tool_call')
}
```

- [ ] **Step 2: Write the failing test**

`src/main/runtime/graph-tools.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildNodeToolSet, HANDOFF_TOOL, type McpToolInfo } from './graph-tools'
import { ToolNameRegistry } from '../mcp/naming'
import { emptyGraph, createAgentNode } from '@shared/graph-defaults'
import type { Graph } from '@shared/types'

function graphWith(edges: Graph['edges']): Graph {
  const g = emptyGraph()
  g.nodes.push(
    createAgentNode({ x: 0, y: 0 }, { id: 'a', name: 'Router' }),
    createAgentNode({ x: 0, y: 0 }, { id: 'b', name: 'Writer' }),
    createAgentNode({ x: 0, y: 0 }, { id: 'c', name: 'Code Reviewer' })
  )
  g.edges.push(...edges)
  g.entryNodeId = 'a'
  return g
}

const available: McpToolInfo[] = [
  { serverId: 's1', serverName: 'FreeCAD', name: 'create_object', description: 'Creates', inputSchema: { type: 'object' } },
  { serverId: 's1', serverName: 'FreeCAD', name: 'delete_object', description: 'Deletes', inputSchema: { type: 'object' } },
  { serverId: 's2', serverName: 'Files', name: 'read', description: '', inputSchema: { type: 'object' } }
]

describe('buildNodeToolSet', () => {
  it('exposes only granted MCP tools with prefixed names', () => {
    const g = graphWith([])
    g.nodes[0].tools = [{ serverId: 's1', names: ['create_object'] }]
    const set = buildNodeToolSet(g, g.nodes[0], available, new ToolNameRegistry())
    expect(set.defs.map((d) => d.name)).toEqual(['FreeCAD__create_object'])
    expect(set.mcp.get('FreeCAD__create_object')).toEqual({ serverId: 's1', toolName: 'create_object' })
    expect(set.autoHandoff).toBeNull()
    expect(set.handoffTargets).toBeNull()
  })

  it('grants every tool of a server with "*" and fills empty descriptions', () => {
    const g = graphWith([])
    g.nodes[0].tools = [{ serverId: 's2', names: '*' }]
    const set = buildNodeToolSet(g, g.nodes[0], available, new ToolNameRegistry())
    expect(set.defs).toHaveLength(1)
    expect(set.defs[0].description).toBe('Tool read from Files')
  })

  it('adds one delegate tool per delegate edge', () => {
    const g = graphWith([
      { id: 'e1', source: 'a', target: 'b', kind: 'delegate', description: 'Ask for prose' },
      { id: 'e2', source: 'a', target: 'c', kind: 'delegate' }
    ])
    const set = buildNodeToolSet(g, g.nodes[0], [], new ToolNameRegistry())
    const names = set.defs.map((d) => d.name)
    expect(names).toEqual(['delegate_to_writer', 'delegate_to_code_reviewer'])
    expect(set.delegates.get('delegate_to_writer')?.id).toBe('e1')
    expect(set.defs[0].description).toBe('Ask for prose')
    expect(set.defs[1].description).toBe('Delegate a task to the "Code Reviewer" agent and get its result back.')
    expect(set.defs[0].inputSchema).toEqual({
      type: 'object',
      properties: { task: { type: 'string', description: 'The task or question to hand to this agent. Include all context it needs.' } },
      required: ['task']
    })
  })

  it('uses automatic handoff for a single handoff edge', () => {
    const g = graphWith([{ id: 'e1', source: 'a', target: 'b', kind: 'handoff' }])
    const set = buildNodeToolSet(g, g.nodes[0], [], new ToolNameRegistry())
    expect(set.autoHandoff?.id).toBe('e1')
    expect(set.defs.some((d) => d.name === HANDOFF_TOOL)).toBe(false)
  })

  it('adds a handoff tool with an enum of targets for two or more handoff edges', () => {
    const g = graphWith([
      { id: 'e1', source: 'a', target: 'b', kind: 'handoff', description: 'For writing tasks' },
      { id: 'e2', source: 'a', target: 'c', kind: 'handoff' }
    ])
    const set = buildNodeToolSet(g, g.nodes[0], [], new ToolNameRegistry())
    const handoff = set.defs.find((d) => d.name === HANDOFF_TOOL)!
    expect(set.autoHandoff).toBeNull()
    expect(set.handoffTargets?.get('Writer')?.id).toBe('e1')
    expect(set.handoffTargets?.get('Code Reviewer')?.id).toBe('e2')
    expect((handoff.inputSchema as { properties: { target: { enum: string[] } } }).properties.target.enum).toEqual([
      'Writer',
      'Code Reviewer'
    ])
    expect(handoff.description).toContain('- Writer: For writing tasks')
    expect(handoff.description).toContain('- Code Reviewer')
  })

  it('ignores edges whose target no longer exists', () => {
    const g = graphWith([{ id: 'e1', source: 'a', target: 'ghost', kind: 'handoff' }])
    const set = buildNodeToolSet(g, g.nodes[0], [], new ToolNameRegistry())
    expect(set.autoHandoff).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/runtime/graph-tools.test.ts`
Expected: FAIL, cannot find module `./graph-tools`.

- [ ] **Step 4: Implement**

`src/main/runtime/graph-tools.ts`:
```ts
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
      const label = uniqueName(child.name, (n) => targets.has(n), 200)
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
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/main/runtime/graph-tools.test.ts && npm run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/providers/types.ts src/main/runtime/graph-tools.ts src/main/runtime/graph-tools.test.ts
git commit -m "Add neutral provider types and node tool set builder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Run engine

**Files:**
- Create: `src/main/runtime/engine.ts`
- Test: `src/main/runtime/engine.test.ts`

**Interfaces:**
- Consumes: `buildNodeToolSet`, `HANDOFF_TOOL`, `McpToolInfo`, `NodeToolSet` from `./graph-tools`; `validateGraph`, `hasErrors` from `./validate`; `ToolNameRegistry`, `ToolRef` from `../mcp/naming`; provider types from `../providers/types`; `RunEvent` from `@shared/events`.
- Produces: `interface EngineDeps { getProvider(id: ProviderId): ChatProvider; getApiKey(id: ProviderId): Promise<string | null>; listMcpTools(grants: ToolGrant[]): Promise<{ tools: McpToolInfo[]; warnings: string[] }>; callMcpTool(ref: ToolRef, args: unknown, signal: AbortSignal): Promise<{ content: string; isError: boolean }>; limits: RunLimits; emit(event: RunEvent): void }`, `interface RunOptions { runId: string; graph: Graph; input: string; signal: AbortSignal; deps: EngineDeps }`, `runGraph(opts: RunOptions): Promise<void>` (never throws; always ends with exactly one of `run.finished`, `run.error`, `run.cancelled`), `errorMessage(err: unknown): string`.

- [ ] **Step 1: Write the failing tests**

`src/main/runtime/engine.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { runGraph, type EngineDeps } from './engine'
import type { AssistantPart, ChatProvider, ChatRequest } from '../providers/types'
import type { RunEvent } from '@shared/events'
import { DEFAULT_LIMITS, type Graph, type RunLimits } from '@shared/types'
import { emptyGraph, createAgentNode } from '@shared/graph-defaults'
import type { McpToolInfo } from './graph-tools'

type Script = Array<AssistantPart[] | ((req: ChatRequest) => AssistantPart[])>

function fakeProvider(script: Script): ChatProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  return {
    id: 'anthropic',
    requests,
    async listModels() {
      return []
    },
    async chat(req, onTextDelta) {
      requests.push(req)
      const next = script.shift()
      if (!next) throw new Error('script exhausted')
      const parts = typeof next === 'function' ? next(req) : next
      for (const p of parts) if (p.type === 'text') onTextDelta(p.text)
      return { parts, stopReason: parts.some((p) => p.type === 'tool_call') ? 'tool_use' : 'end' }
    }
  }
}

function text(t: string): AssistantPart[] {
  return [{ type: 'text', text: t }]
}

function call(name: string, args: Record<string, unknown>, id = 'c1'): AssistantPart[] {
  return [{ type: 'tool_call', id, name, args }]
}

interface Harness {
  events: RunEvent[]
  deps: EngineDeps
  provider: ReturnType<typeof fakeProvider>
}

function harness(
  script: Script,
  opts: { limits?: Partial<RunLimits>; tools?: McpToolInfo[]; apiKey?: string | null; callTool?: EngineDeps['callMcpTool'] } = {}
): Harness {
  const events: RunEvent[] = []
  const provider = fakeProvider(script)
  const deps: EngineDeps = {
    getProvider: () => provider,
    getApiKey: async () => (opts.apiKey === undefined ? 'key' : opts.apiKey),
    listMcpTools: async () => ({ tools: opts.tools ?? [], warnings: [] }),
    callMcpTool: opts.callTool ?? (async () => ({ content: 'unused', isError: false })),
    limits: { ...DEFAULT_LIMITS, ...opts.limits },
    emit: (e) => events.push(e)
  }
  return { events, deps, provider }
}

function graph(edges: Graph['edges'], nodeIds = ['a', 'b', 'c']): Graph {
  const g = emptyGraph()
  for (const id of nodeIds) g.nodes.push(createAgentNode({ x: 0, y: 0 }, { id, name: id.toUpperCase() }))
  g.edges.push(...edges)
  g.entryNodeId = 'a'
  return g
}

function types(events: RunEvent[]): string[] {
  return events.map((e) => e.type)
}

async function run(h: Harness, g: Graph, input = 'hello', signal = new AbortController().signal) {
  await runGraph({ runId: 'r1', graph: g, input, signal, deps: h.deps })
}

describe('runGraph', () => {
  it('runs a single node and finishes with its text', async () => {
    const h = harness([text('done')])
    await run(h, graph([], ['a']))
    expect(types(h.events)).toEqual(['run.started', 'node.started', 'node.text', 'node.finished', 'run.finished'])
    expect(h.events.at(-1)).toEqual({ type: 'run.finished', runId: 'r1', output: 'done' })
    expect(h.provider.requests[0].messages).toEqual([{ role: 'user', content: 'hello' }])
    expect(h.provider.requests[0].system).toBe('')
  })

  it('reports validation errors without starting', async () => {
    const h = harness([])
    const g = graph([], ['a'])
    g.entryNodeId = null
    await run(h, g)
    expect(types(h.events)).toEqual(['run.started', 'run.error'])
  })

  it('hands off automatically along a single handoff edge', async () => {
    const h = harness([text('from A'), text('from B')])
    await run(h, graph([{ id: 'e1', source: 'a', target: 'b', kind: 'handoff' }], ['a', 'b']))
    expect(types(h.events)).toEqual([
      'run.started',
      'node.started',
      'node.text',
      'node.finished',
      'edge.traversed',
      'node.started',
      'node.text',
      'node.finished',
      'run.finished'
    ])
    const bStart = h.events.find((e) => e.type === 'node.started' && e.nodeId === 'b')
    expect(bStart).toMatchObject({ input: 'from A', depth: 0, parentExecutionId: null })
    expect(h.events.find((e) => e.type === 'edge.traversed')).toMatchObject({ edgeId: 'e1', kind: 'handoff', message: 'from A' })
    expect(h.events.at(-1)).toMatchObject({ output: 'from B' })
  })

  it('routes with the handoff tool when there are several handoff edges', async () => {
    const h = harness([call('handoff', { target: 'C', message: 'go C' }), text('C done')])
    await run(
      h,
      graph([
        { id: 'e1', source: 'a', target: 'b', kind: 'handoff' },
        { id: 'e2', source: 'a', target: 'c', kind: 'handoff' }
      ])
    )
    const toolNames = h.provider.requests[0].tools.map((t) => t.name)
    expect(toolNames).toEqual(['handoff'])
    expect(h.events.some((e) => e.type === 'node.started' && e.nodeId === 'b')).toBe(false)
    expect(h.events.find((e) => e.type === 'node.started' && e.nodeId === 'c')).toMatchObject({ input: 'go C' })
    expect(h.events.find((e) => e.type === 'edge.traversed')).toMatchObject({ edgeId: 'e2', message: 'go C' })
    expect(h.events.at(-1)).toMatchObject({ type: 'run.finished', output: 'C done' })
  })

  it('returns an error result for an unknown handoff target and keeps going', async () => {
    const h = harness([call('handoff', { target: 'Nope', message: 'x' }), text('recovered')])
    await run(
      h,
      graph([
        { id: 'e1', source: 'a', target: 'b', kind: 'handoff' },
        { id: 'e2', source: 'a', target: 'c', kind: 'handoff' }
      ])
    )
    const result = h.events.find((e) => e.type === 'node.tool.result')
    expect(result).toMatchObject({ isError: true })
    expect(h.provider.requests[1].messages.at(-1)).toMatchObject({ role: 'tool' })
    expect(h.events.at(-1)).toMatchObject({ type: 'run.finished', output: 'recovered' })
  })

  it('delegates to a child and feeds its result back as a tool result', async () => {
    const h = harness([call('delegate_to_b', { task: 'do it' }), text('B result'), text('final')])
    await run(h, graph([{ id: 'e1', source: 'a', target: 'b', kind: 'delegate' }], ['a', 'b']))
    expect(h.provider.requests[0].tools.map((t) => t.name)).toEqual(['delegate_to_b'])
    const bStart = h.events.find((e) => e.type === 'node.started' && e.nodeId === 'b')
    const aStart = h.events.find((e) => e.type === 'node.started' && e.nodeId === 'a')
    expect(bStart).toMatchObject({ input: 'do it', depth: 1, parentExecutionId: (aStart as { executionId: string }).executionId })
    expect(h.events.find((e) => e.type === 'edge.traversed')).toMatchObject({ kind: 'delegate', edgeId: 'e1', message: 'do it' })
    expect(h.events.find((e) => e.type === 'node.tool.result')).toMatchObject({ content: 'B result', isError: false })
    expect(h.provider.requests[2].messages.at(-1)).toEqual({ role: 'tool', results: [{ callId: 'c1', content: 'B result', isError: false }] })
    expect(h.events.at(-1)).toMatchObject({ type: 'run.finished', output: 'final' })
  })

  it('lets a delegated sub-run follow its own handoffs before returning', async () => {
    const h = harness([call('delegate_to_b', { task: 't' }), text('b'), text('c'), text('done')])
    await run(
      h,
      graph([
        { id: 'e1', source: 'a', target: 'b', kind: 'delegate' },
        { id: 'e2', source: 'b', target: 'c', kind: 'handoff' }
      ])
    )
    expect(h.events.find((e) => e.type === 'node.tool.result')).toMatchObject({ content: 'c' })
    expect(h.events.at(-1)).toMatchObject({ type: 'run.finished', output: 'done' })
  })

  it('stops a cyclic graph at the total step limit', async () => {
    const script: Script = []
    for (let i = 0; i < 10; i++) script.push(text(`step ${i}`))
    const h = harness(script, { limits: { maxTotalSteps: 3 } })
    await run(h, graph([{ id: 'e1', source: 'a', target: 'a', kind: 'handoff' }], ['a']))
    expect(h.events.at(-1)).toMatchObject({ type: 'run.error' })
    expect((h.events.at(-1) as { error: string }).error).toMatch(/step limit/)
    expect(h.provider.requests).toHaveLength(3)
  })

  it('stops at the per-node turn limit', async () => {
    const tools: McpToolInfo[] = [{ serverId: 's', serverName: 'S', name: 'ping', description: 'p', inputSchema: { type: 'object' } }]
    const script: Script = []
    for (let i = 0; i < 10; i++) script.push(call('S__ping', {}, `c${i}`))
    const h = harness(script, { limits: { maxTurns: 2 }, tools, callTool: async () => ({ content: 'pong', isError: false }) })
    const g = graph([], ['a'])
    g.nodes[0].tools = [{ serverId: 's', names: '*' }]
    await run(h, g)
    expect(h.provider.requests).toHaveLength(2)
    expect((h.events.at(-1) as { error: string }).error).toMatch(/turn limit/)
    expect(h.events.some((e) => e.type === 'node.error')).toBe(true)
  })

  it('stops at the delegation depth limit', async () => {
    const script: Script = []
    for (let i = 0; i < 10; i++) script.push(call('delegate_to_a', { task: 'again' }, `c${i}`))
    const h = harness(script, { limits: { maxDelegationDepth: 2 } })
    await run(h, graph([{ id: 'e1', source: 'a', target: 'a', kind: 'delegate' }], ['a']))
    expect((h.events.at(-1) as { error: string }).error).toMatch(/depth/)
  })

  it('calls MCP tools and passes tool errors back to the model', async () => {
    const tools: McpToolInfo[] = [{ serverId: 's', serverName: 'S', name: 'read', description: 'r', inputSchema: { type: 'object' } }]
    const calls: unknown[] = []
    const h = harness([call('S__read', { path: '/x' }), text('ok')], {
      tools,
      callTool: async (ref, args) => {
        calls.push([ref, args])
        throw new Error('boom')
      }
    })
    const g = graph([], ['a'])
    g.nodes[0].tools = [{ serverId: 's', names: ['read'] }]
    await run(h, g)
    expect(calls).toEqual([[{ serverId: 's', toolName: 'read' }, { path: '/x' }]])
    expect(h.events.find((e) => e.type === 'node.tool.result')).toMatchObject({ isError: true, content: 'Tool error: boom' })
    expect(h.events.at(-1)).toMatchObject({ type: 'run.finished', output: 'ok' })
  })

  it('fails the run when the provider has no API key', async () => {
    const h = harness([text('never')], { apiKey: null })
    await run(h, graph([], ['a']))
    expect(types(h.events)).toEqual(['run.started', 'node.started', 'node.error', 'run.error'])
    expect((h.events.at(-1) as { error: string }).error).toMatch(/API key/)
  })

  it('reports provider errors', async () => {
    const h = harness([
      () => {
        throw new Error('401 invalid key')
      }
    ])
    await run(h, graph([], ['a']))
    expect(h.events.at(-1)).toEqual({ type: 'run.error', runId: 'r1', error: '401 invalid key' })
  })

  it('cancels when the signal aborts during a provider call', async () => {
    const controller = new AbortController()
    const provider: ChatProvider = {
      id: 'anthropic',
      async listModels() {
        return []
      },
      chat(req) {
        return new Promise((_, reject) => {
          req.signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      }
    }
    const events: RunEvent[] = []
    const deps: EngineDeps = {
      getProvider: () => provider,
      getApiKey: async () => 'k',
      listMcpTools: async () => ({ tools: [], warnings: [] }),
      callMcpTool: async () => ({ content: '', isError: false }),
      limits: DEFAULT_LIMITS,
      emit: (e) => events.push(e)
    }
    const p = runGraph({ runId: 'r1', graph: graph([], ['a']), input: 'x', signal: controller.signal, deps })
    await new Promise((r) => setTimeout(r, 0))
    controller.abort()
    await p
    expect(types(events)).toEqual(['run.started', 'node.started', 'run.cancelled'])
  })

  it('surfaces MCP warnings and passes node settings to the provider', async () => {
    const h = harness([text('x')])
    h.deps.listMcpTools = async () => ({ tools: [], warnings: ['server gone'] })
    const g = graph([], ['a'])
    g.nodes[0].instructions = 'be brief'
    g.nodes[0].temperature = 0.2
    g.nodes[0].maxTokens = 500
    await run(h, g)
    expect(h.events[2]).toEqual({ type: 'run.warning', runId: 'r1', message: 'server gone' })
    expect(h.provider.requests[0]).toMatchObject({ system: 'be brief', temperature: 0.2, maxTokens: 500, model: 'claude-opus-5', apiKey: 'key' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/runtime/engine.test.ts`
Expected: FAIL, cannot find module `./engine`.

- [ ] **Step 3: Implement**

`src/main/runtime/engine.ts`:
```ts
import type { AgentNode, Graph, GraphEdge, ProviderId, RunLimits, ToolGrant } from '@shared/types'
import type { RunEvent } from '@shared/events'
import { textOf, toolCallsOf, type ChatProvider, type Message, type ToolCallPart, type ToolResult } from '../providers/types'
import { ToolNameRegistry, type ToolRef } from '../mcp/naming'
import { buildNodeToolSet, HANDOFF_TOOL, type McpToolInfo, type NodeToolSet } from './graph-tools'
import { hasErrors, validateGraph } from './validate'

export interface EngineDeps {
  getProvider(id: ProviderId): ChatProvider
  getApiKey(id: ProviderId): Promise<string | null>
  listMcpTools(grants: ToolGrant[]): Promise<{ tools: McpToolInfo[]; warnings: string[] }>
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

interface RunContext {
  runId: string
  graph: Graph
  signal: AbortSignal
  deps: EngineDeps
  steps: number
  registry: ToolNameRegistry
  nodesById: Map<string, AgentNode>
}

interface NodeResult {
  executionId: string
  output: string
  handoff?: { edge: GraphEdge; message: string }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
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
    nodesById: new Map(graph.nodes.map((n) => [n.id, n]))
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

    const { tools: available, warnings } = await deps.listMcpTools(node.tools)
    for (const message of warnings) deps.emit({ type: 'run.warning', runId, message })
    const toolSet = buildNodeToolSet(ctx.graph, node, available, ctx.registry)

    const messages: Message[] = [{ role: 'user', content: input }]
    const maxTurns = node.maxTurns ?? deps.limits.maxTurns

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
          messages,
          tools: toolSet.defs,
          temperature: node.temperature,
          maxTokens: node.maxTokens,
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
          handoff: toolSet.autoHandoff ? { edge: toolSet.autoHandoff, message: text } : undefined
        }
      }

      const results: ToolResult[] = []
      for (const call of calls) {
        deps.emit({ type: 'node.tool.call', runId, executionId, callId: call.id, name: call.name, args: call.args })

        if (call.name === HANDOFF_TOOL && toolSet.handoffTargets) {
          const target = String(call.args['target'] ?? '')
          const edge = toolSet.handoffTargets.get(target)
          if (!edge) {
            const content = `Unknown handoff target "${target}". Valid targets: ${[...toolSet.handoffTargets.keys()].join(', ')}.`
            deps.emit({ type: 'node.tool.result', runId, executionId, callId: call.id, content, isError: true })
            results.push({ callId: call.id, content, isError: true })
            continue
          }
          const message = String(call.args['message'] ?? text)
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
    if (depth + 1 > ctx.deps.limits.maxDelegationDepth) {
      throw new RunLimitReached(`Delegation depth limit (${ctx.deps.limits.maxDelegationDepth}) reached.`)
    }
    const child = ctx.nodesById.get(delegateEdge.target)!
    const task = String(call.args['task'] ?? '')
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
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/main/runtime/engine.test.ts && npm run typecheck`
Expected: all 15 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/runtime/engine.ts src/main/runtime/engine.test.ts
git commit -m "Add graph run engine with handoff, delegation, limits, and cancellation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Anthropic provider adapter

**Files:**
- Create: `src/main/providers/anthropic.ts`
- Test: `src/main/providers/anthropic.test.ts`

**Interfaces:**
- Consumes: `ChatProvider`, `ChatRequest`, `ChatResponse`, `Message`, `ToolDef`, `AssistantPart`, `StopReason` from `./types`.
- Produces: `toAnthropicTools(tools: ToolDef[]): Anthropic.Tool[]`, `toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[]`, `fromAnthropicMessage(msg: Anthropic.Message): ChatResponse`, `anthropicProvider: ChatProvider`, `DEFAULT_MAX_TOKENS = 16000`.

Notes for the implementer: the SDK is `@anthropic-ai/sdk` 0.124. Streaming uses `client.messages.stream(params, { signal })`, `stream.on('text', delta => ...)`, and `await stream.finalMessage()`. Never send a `thinking` parameter. Send `temperature` only when the request sets it. Assistant turns are replayed from `raw.content` when it came from Anthropic so thinking blocks survive; otherwise they are rebuilt from parts. Empty text blocks are rejected by the API, so filter them out.

- [ ] **Step 1: Write the failing test**

`src/main/providers/anthropic.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { toAnthropicMessages, toAnthropicTools, fromAnthropicMessage } from './anthropic'
import type { Message } from './types'

describe('toAnthropicTools', () => {
  it('maps tool definitions', () => {
    expect(toAnthropicTools([{ name: 'a', description: 'A tool', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } }])).toEqual([
      { name: 'a', description: 'A tool', input_schema: { type: 'object', properties: { x: { type: 'string' } } } }
    ])
  })
})

describe('toAnthropicMessages', () => {
  it('maps user messages', () => {
    expect(toAnthropicMessages([{ role: 'user', content: 'hi' }])).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('rebuilds assistant messages from parts and drops empty text', () => {
    const msgs: Message[] = [
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: '' },
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_call', id: 'toolu_1', name: 'read', args: { path: '/x' } }
        ]
      }
    ]
    expect(toAnthropicMessages(msgs)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'toolu_1', name: 'read', input: { path: '/x' } }
        ]
      }
    ])
  })

  it('replays raw Anthropic content verbatim', () => {
    const raw = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'ok' }]
    const msgs: Message[] = [{ role: 'assistant', parts: [{ type: 'text', text: 'ok' }], raw: { provider: 'anthropic', content: raw } }]
    expect(toAnthropicMessages(msgs)).toEqual([{ role: 'assistant', content: raw }])
  })

  it('ignores raw content from other providers', () => {
    const msgs: Message[] = [{ role: 'assistant', parts: [{ type: 'text', text: 'ok' }], raw: { provider: 'openai', content: { foo: 1 } } }]
    expect(toAnthropicMessages(msgs)).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }])
  })

  it('uses a placeholder when an assistant turn has no content', () => {
    expect(toAnthropicMessages([{ role: 'assistant', parts: [] }])).toEqual([{ role: 'assistant', content: [{ type: 'text', text: '(no output)' }] }])
  })

  it('maps tool results to a user message with tool_result blocks', () => {
    const msgs: Message[] = [
      {
        role: 'tool',
        results: [
          { callId: 'toolu_1', content: 'file contents' },
          { callId: 'toolu_2', content: 'boom', isError: true }
        ]
      }
    ]
    expect(toAnthropicMessages(msgs)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file contents' },
          { type: 'tool_result', tool_use_id: 'toolu_2', content: 'boom', is_error: true }
        ]
      }
    ])
  })
})

describe('fromAnthropicMessage', () => {
  it('extracts text and tool calls and keeps raw content', () => {
    const content = [
      { type: 'text', text: 'Hello', citations: null },
      { type: 'tool_use', id: 'toolu_9', name: 'search', input: { q: 'x' } }
    ]
    const msg = { content, stop_reason: 'tool_use' } as unknown as Anthropic.Message
    expect(fromAnthropicMessage(msg)).toEqual({
      parts: [
        { type: 'text', text: 'Hello' },
        { type: 'tool_call', id: 'toolu_9', name: 'search', args: { q: 'x' } }
      ],
      stopReason: 'tool_use',
      raw: { provider: 'anthropic', content }
    })
  })

  it('maps stop reasons', () => {
    const mk = (stop_reason: string) => fromAnthropicMessage({ content: [], stop_reason } as unknown as Anthropic.Message).stopReason
    expect(mk('end_turn')).toBe('end')
    expect(mk('max_tokens')).toBe('max_tokens')
    expect(mk('refusal')).toBe('refusal')
    expect(mk('stop_sequence')).toBe('end')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/providers/anthropic.test.ts`
Expected: FAIL, cannot find module `./anthropic`.

- [ ] **Step 3: Implement**

`src/main/providers/anthropic.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk'
import type { AssistantPart, ChatProvider, ChatResponse, Message, StopReason, ToolDef } from './types'

export const DEFAULT_MAX_TOKENS = 16000

export function toAnthropicTools(tools: ToolDef[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { ...t.inputSchema, type: 'object' } as Anthropic.Tool.InputSchema
  }))
}

export function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    switch (m.role) {
      case 'user':
        return { role: 'user', content: m.content }
      case 'assistant': {
        if (m.raw?.provider === 'anthropic') {
          return { role: 'assistant', content: m.raw.content as Anthropic.ContentBlockParam[] }
        }
        const content: Anthropic.ContentBlockParam[] = []
        for (const part of m.parts) {
          if (part.type === 'text') {
            if (part.text.length > 0) content.push({ type: 'text', text: part.text })
          } else {
            content.push({ type: 'tool_use', id: part.id, name: part.name, input: part.args })
          }
        }
        if (content.length === 0) content.push({ type: 'text', text: '(no output)' })
        return { role: 'assistant', content }
      }
      case 'tool':
        return {
          role: 'user',
          content: m.results.map((r): Anthropic.ToolResultBlockParam => ({
            type: 'tool_result',
            tool_use_id: r.callId,
            content: r.content,
            ...(r.isError ? { is_error: true } : {})
          }))
        }
    }
  })
}

function mapStopReason(reason: Anthropic.StopReason | null): StopReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_use'
    case 'max_tokens':
      return 'max_tokens'
    case 'refusal':
      return 'refusal'
    default:
      return 'end'
  }
}

export function fromAnthropicMessage(msg: Anthropic.Message): ChatResponse {
  const parts: AssistantPart[] = []
  for (const block of msg.content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'tool_use') {
      parts.push({ type: 'tool_call', id: block.id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> })
    }
  }
  return { parts, stopReason: mapStopReason(msg.stop_reason), raw: { provider: 'anthropic', content: msg.content } }
}

export const anthropicProvider: ChatProvider = {
  id: 'anthropic',

  async listModels(apiKey, signal) {
    const client = new Anthropic({ apiKey })
    const ids: string[] = []
    for await (const model of client.models.list({ limit: 100 }, { signal })) ids.push(model.id)
    return ids
  },

  async chat(req, onTextDelta) {
    const client = new Anthropic({ apiKey: req.apiKey, maxRetries: 2 })
    const params: Anthropic.MessageStreamParams = {
      model: req.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: toAnthropicMessages(req.messages)
    }
    if (req.system.trim()) params.system = req.system
    if (req.tools.length > 0) params.tools = toAnthropicTools(req.tools)
    if (req.temperature !== undefined) params.temperature = req.temperature

    const stream = client.messages.stream(params, { signal: req.signal })
    stream.on('text', (delta) => onTextDelta(delta))
    const final = await stream.finalMessage()
    return fromAnthropicMessage(final)
  }
}
```

If `Anthropic.MessageStreamParams` does not exist in the installed SDK, use `Anthropic.MessageCreateParamsBase` instead; check with `grep -n "MessageStreamParams" node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/main/providers/anthropic.test.ts && npm run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/providers/anthropic.ts src/main/providers/anthropic.test.ts
git commit -m "Add Anthropic provider adapter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: OpenAI-compatible adapter, fallback models, provider index

**Files:**
- Create: `src/main/providers/openai-compatible.ts`, `src/main/providers/fallback-models.ts`, `src/main/providers/index.ts`
- Test: `src/main/providers/openai-compatible.test.ts`

**Interfaces:**
- Consumes: provider types from `./types`; `errorMessage` from `../runtime/engine`; `ModelListResult` from `@shared/ipc`.
- Produces: `toOpenAITools(tools)`, `toOpenAIMessages(system, messages)`, `newAccumulator()`, `feedChunk(acc, chunk): string`, `finishAccumulator(acc): ChatResponse`, `isOpenAIChatModel(id): boolean`, `createOpenAICompatibleProvider(opts)`, `openaiProvider`, `fireworksProvider`, `FALLBACK_MODELS: Record<ProviderId, string[]>`, `getProvider(id: ProviderId): ChatProvider`, `listModelsWithFallback(id: ProviderId, apiKey: string | null): Promise<ModelListResult>`.

- [ ] **Step 1: Write the failing test**

`src/main/providers/openai-compatible.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type OpenAI from 'openai'
import { toOpenAIMessages, toOpenAITools, newAccumulator, feedChunk, finishAccumulator, isOpenAIChatModel } from './openai-compatible'
import type { Message } from './types'

type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk

function chunk(delta: Record<string, unknown>, finish: string | null = null): Chunk {
  return { id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] } as unknown as Chunk
}

describe('toOpenAITools', () => {
  it('wraps tools as functions', () => {
    expect(toOpenAITools([{ name: 'a', description: 'd', inputSchema: { type: 'object' } }])).toEqual([
      { type: 'function', function: { name: 'a', description: 'd', parameters: { type: 'object' } } }
    ])
  })
})

describe('toOpenAIMessages', () => {
  it('prepends the system prompt only when non-empty', () => {
    expect(toOpenAIMessages('', [{ role: 'user', content: 'hi' }])).toEqual([{ role: 'user', content: 'hi' }])
    expect(toOpenAIMessages('be nice', [{ role: 'user', content: 'hi' }])).toEqual([
      { role: 'system', content: 'be nice' },
      { role: 'user', content: 'hi' }
    ])
  })

  it('maps assistant tool calls and tool results', () => {
    const msgs: Message[] = [
      { role: 'assistant', parts: [{ type: 'text', text: 'checking' }, { type: 'tool_call', id: 'call_1', name: 'read', args: { p: 1 } }] },
      { role: 'tool', results: [{ callId: 'call_1', content: 'data' }, { callId: 'call_2', content: 'bad', isError: true }] },
      { role: 'assistant', parts: [{ type: 'tool_call', id: 'call_3', name: 'x', args: {} }] }
    ]
    expect(toOpenAIMessages('', msgs)).toEqual([
      {
        role: 'assistant',
        content: 'checking',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"p":1}' } }]
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'data' },
      { role: 'tool', tool_call_id: 'call_2', content: 'Error: bad' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_3', type: 'function', function: { name: 'x', arguments: '{}' } }] }
    ])
  })
})

describe('chunk accumulation', () => {
  it('accumulates text and reports deltas', () => {
    const acc = newAccumulator()
    expect(feedChunk(acc, chunk({ role: 'assistant', content: 'Hel' }))).toBe('Hel')
    expect(feedChunk(acc, chunk({ content: 'lo' }, 'stop'))).toBe('lo')
    expect(finishAccumulator(acc)).toEqual({ parts: [{ type: 'text', text: 'Hello' }], stopReason: 'end' })
  })

  it('assembles streamed tool calls by index', () => {
    const acc = newAccumulator()
    feedChunk(acc, chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'read', arguments: '' } }] }))
    feedChunk(acc, chunk({ tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }))
    feedChunk(acc, chunk({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'list', arguments: '{}' } }] }))
    feedChunk(acc, chunk({ tool_calls: [{ index: 0, function: { arguments: '"/x"}' } }] }, 'tool_calls'))
    expect(finishAccumulator(acc)).toEqual({
      parts: [
        { type: 'tool_call', id: 'call_a', name: 'read', args: { path: '/x' } },
        { type: 'tool_call', id: 'call_b', name: 'list', args: {} }
      ],
      stopReason: 'tool_use'
    })
  })

  it('tolerates malformed arguments and missing ids', () => {
    const acc = newAccumulator()
    feedChunk(acc, chunk({ tool_calls: [{ index: 0, function: { name: 'f', arguments: '{oops' } }] }, 'tool_calls'))
    expect(finishAccumulator(acc).parts).toEqual([{ type: 'tool_call', id: 'call_0', name: 'f', args: {} }])
  })

  it('maps length and content_filter finish reasons', () => {
    const a = newAccumulator()
    feedChunk(a, chunk({ content: 'x' }, 'length'))
    expect(finishAccumulator(a).stopReason).toBe('max_tokens')
    const b = newAccumulator()
    feedChunk(b, chunk({}, 'content_filter'))
    expect(finishAccumulator(b).stopReason).toBe('refusal')
  })

  it('ignores chunks without choices', () => {
    const acc = newAccumulator()
    expect(feedChunk(acc, { choices: [] } as unknown as Chunk)).toBe('')
  })
})

describe('isOpenAIChatModel', () => {
  it('keeps chat models and drops other modalities', () => {
    expect(isOpenAIChatModel('gpt-5')).toBe(true)
    expect(isOpenAIChatModel('o3-mini')).toBe(true)
    expect(isOpenAIChatModel('gpt-4o-audio-preview')).toBe(false)
    expect(isOpenAIChatModel('text-embedding-3-small')).toBe(false)
    expect(isOpenAIChatModel('gpt-image-1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/providers/openai-compatible.test.ts`
Expected: FAIL, cannot find module `./openai-compatible`.

- [ ] **Step 3: Implement the adapter**

`src/main/providers/openai-compatible.ts`:
```ts
import OpenAI from 'openai'
import type { ProviderId } from '@shared/types'
import { textOf, toolCallsOf, type AssistantPart, type ChatProvider, type ChatResponse, type Message, type StopReason, type ToolDef } from './types'

type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam
type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk

export interface OpenAICompatibleOptions {
  id: ProviderId
  baseURL?: string
  maxTokensParam: 'max_completion_tokens' | 'max_tokens'
  filterModels?: (id: string) => boolean
}

export function toOpenAITools(tools: ToolDef[]): ChatTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema }
  }))
}

export function toOpenAIMessages(system: string, messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = []
  if (system.trim()) out.push({ role: 'system', content: system })
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      const text = textOf(m.parts)
      const calls = toolCallsOf(m.parts)
      const msg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = { role: 'assistant', content: text || null }
      if (calls.length > 0) {
        msg.tool_calls = calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args) }
        }))
      }
      out.push(msg)
    } else {
      for (const r of m.results) {
        out.push({ role: 'tool', tool_call_id: r.callId, content: r.isError ? `Error: ${r.content}` : r.content })
      }
    }
  }
  return out
}

export interface ChunkAccumulator {
  text: string
  calls: Map<number, { id: string; name: string; args: string }>
  finish: string | null
}

export function newAccumulator(): ChunkAccumulator {
  return { text: '', calls: new Map(), finish: null }
}

export function feedChunk(acc: ChunkAccumulator, chunk: Chunk): string {
  const choice = chunk.choices?.[0]
  if (!choice) return ''
  const delta = choice.delta ?? {}
  const textDelta = delta.content ?? ''
  acc.text += textDelta
  for (const tc of delta.tool_calls ?? []) {
    const entry = acc.calls.get(tc.index) ?? { id: '', name: '', args: '' }
    if (tc.id) entry.id = tc.id
    if (tc.function?.name) entry.name = tc.function.name
    if (tc.function?.arguments) entry.args += tc.function.arguments
    acc.calls.set(tc.index, entry)
  }
  if (choice.finish_reason) acc.finish = choice.finish_reason
  return textDelta
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function finishAccumulator(acc: ChunkAccumulator): ChatResponse {
  const parts: AssistantPart[] = []
  if (acc.text) parts.push({ type: 'text', text: acc.text })
  const indexes = [...acc.calls.keys()].sort((a, b) => a - b)
  for (const index of indexes) {
    const c = acc.calls.get(index)!
    parts.push({ type: 'tool_call', id: c.id || `call_${index}`, name: c.name, args: parseArgs(c.args) })
  }
  let stopReason: StopReason = 'end'
  if (indexes.length > 0) stopReason = 'tool_use'
  else if (acc.finish === 'length') stopReason = 'max_tokens'
  else if (acc.finish === 'content_filter') stopReason = 'refusal'
  return { parts, stopReason }
}

export function isOpenAIChatModel(id: string): boolean {
  return /^(gpt-|o\d)/.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|moderation|instruct|search)/.test(id)
}

export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): ChatProvider {
  return {
    id: opts.id,

    async listModels(apiKey, signal) {
      const client = new OpenAI({ apiKey, baseURL: opts.baseURL })
      const ids: string[] = []
      for await (const model of client.models.list({ signal })) ids.push(model.id)
      const keep = opts.filterModels ?? (() => true)
      return ids.filter(keep).sort()
    },

    async chat(req, onTextDelta) {
      const client = new OpenAI({ apiKey: req.apiKey, baseURL: opts.baseURL, maxRetries: 2 })
      const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        model: req.model,
        messages: toOpenAIMessages(req.system, req.messages),
        stream: true
      }
      if (req.tools.length > 0) body.tools = toOpenAITools(req.tools)
      if (req.temperature !== undefined) body.temperature = req.temperature
      if (req.maxTokens !== undefined) body[opts.maxTokensParam] = req.maxTokens

      const stream = await client.chat.completions.create(body, { signal: req.signal })
      const acc = newAccumulator()
      for await (const chunk of stream) {
        const delta = feedChunk(acc, chunk)
        if (delta) onTextDelta(delta)
      }
      return finishAccumulator(acc)
    }
  }
}

export const openaiProvider = createOpenAICompatibleProvider({
  id: 'openai',
  maxTokensParam: 'max_completion_tokens',
  filterModels: isOpenAIChatModel
})

export const fireworksProvider = createOpenAICompatibleProvider({
  id: 'fireworks',
  baseURL: 'https://api.fireworks.ai/inference/v1',
  maxTokensParam: 'max_tokens'
})
```

- [ ] **Step 4: Write the fallback list and provider index**

`src/main/providers/fallback-models.ts`:
```ts
import type { ProviderId } from '@shared/types'

export const FALLBACK_MODELS: Record<ProviderId, string[]> = {
  anthropic: ['claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
  fireworks: [
    'accounts/fireworks/models/llama-v3p3-70b-instruct',
    'accounts/fireworks/models/deepseek-v3',
    'accounts/fireworks/models/qwen3-235b-a22b'
  ]
}
```

`src/main/providers/index.ts`:
```ts
import type { ProviderId } from '@shared/types'
import type { ModelListResult } from '@shared/ipc'
import type { ChatProvider } from './types'
import { anthropicProvider } from './anthropic'
import { fireworksProvider, openaiProvider } from './openai-compatible'
import { FALLBACK_MODELS } from './fallback-models'
import { errorMessage } from '../runtime/engine'

const providers: Record<ProviderId, ChatProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  fireworks: fireworksProvider
}

export function getProvider(id: ProviderId): ChatProvider {
  return providers[id]
}

export async function listModelsWithFallback(id: ProviderId, apiKey: string | null): Promise<ModelListResult> {
  if (!apiKey) return { models: FALLBACK_MODELS[id], source: 'fallback', error: 'No API key configured.' }
  try {
    const models = await getProvider(id).listModels(apiKey, AbortSignal.timeout(15000))
    if (models.length === 0) throw new Error('The API returned no models.')
    return { models, source: 'api' }
  } catch (err) {
    return { models: FALLBACK_MODELS[id], source: 'fallback', error: errorMessage(err) }
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/main/providers && npm run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/providers
git commit -m "Add OpenAI-compatible adapter, fallback models, and provider index

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: MCP registry

**Files:**
- Create: `src/main/mcp/registry.ts`
- Test: `src/main/mcp/registry.test.ts`

**Interfaces:**
- Consumes: `McpServerConfig` from `@shared/types`; `McpToolInfo` from `../runtime/graph-tools`; `ToolRef` from `./naming`.
- Produces: `type TransportFactory = (config: McpServerConfig) => Transport`, `defaultTransportFactory`, `interface ToolCallOutcome { content: string; isError: boolean }`, `summarizeResult(result: unknown): ToolCallOutcome`, `class McpRegistry { constructor(getConfigs: () => McpServerConfig[], transportFactory?: TransportFactory); listTools(serverId: string): Promise<McpToolInfo[]>; callTool(ref: ToolRef, args: unknown, signal?: AbortSignal): Promise<ToolCallOutcome>; test(config: McpServerConfig): Promise<McpToolInfo[]>; invalidate(serverId: string): Promise<void>; closeAll(): Promise<void> }`.

Notes: SDK subpath imports are `@modelcontextprotocol/sdk/client/index.js`, `.../client/stdio.js`, `.../client/streamableHttp.js`, `.../shared/transport.js`, `.../server/mcp.js`, `.../inMemory.js`. `InMemoryTransport` queues messages until the other side starts, so a factory may return the client half of a linked pair while the server connects in the background.

- [ ] **Step 1: Write the failing test**

`src/main/mcp/registry.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z } from 'zod'
import { McpRegistry, summarizeResult } from './registry'
import type { McpServerConfig } from '@shared/types'

let connections = 0

function makeTransport(): Transport {
  connections++
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  server.registerTool('echo', { description: 'Echoes text', inputSchema: { text: z.string() } }, async ({ text }) => ({
    content: [{ type: 'text', text: `echo:${text}` }]
  }))
  server.registerTool('fail', { description: 'Always fails', inputSchema: {} }, async () => ({
    content: [{ type: 'text', text: 'nope' }],
    isError: true
  }))
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  void server.connect(serverTransport)
  return clientTransport
}

const config: McpServerConfig = { id: 's1', name: 'Test Server', transport: 'stdio', command: 'unused', args: [] }

describe('McpRegistry', () => {
  it('lists tools with server metadata', async () => {
    const registry = new McpRegistry(() => [config], makeTransport)
    const tools = await registry.listTools('s1')
    expect(tools.map((t) => t.name)).toEqual(['echo', 'fail'])
    expect(tools[0]).toMatchObject({ serverId: 's1', serverName: 'Test Server', description: 'Echoes text' })
    expect(tools[0].inputSchema).toMatchObject({ type: 'object' })
    await registry.closeAll()
  })

  it('reuses one connection per server', async () => {
    connections = 0
    const registry = new McpRegistry(() => [config], makeTransport)
    await registry.listTools('s1')
    await registry.callTool({ serverId: 's1', toolName: 'echo' }, { text: 'hi' })
    expect(connections).toBe(1)
    await registry.invalidate('s1')
    await registry.listTools('s1')
    expect(connections).toBe(2)
    await registry.closeAll()
  })

  it('calls tools and reports errors', async () => {
    const registry = new McpRegistry(() => [config], makeTransport)
    expect(await registry.callTool({ serverId: 's1', toolName: 'echo' }, { text: 'hi' })).toEqual({ content: 'echo:hi', isError: false })
    expect(await registry.callTool({ serverId: 's1', toolName: 'fail' }, {})).toEqual({ content: 'nope', isError: true })
    await registry.closeAll()
  })

  it('rejects unknown servers', async () => {
    const registry = new McpRegistry(() => [], makeTransport)
    await expect(registry.listTools('nope')).rejects.toThrow(/not configured/)
  })

  it('tests a config without caching the connection', async () => {
    connections = 0
    const registry = new McpRegistry(() => [], makeTransport)
    const tools = await registry.test(config)
    expect(tools.map((t) => t.name)).toEqual(['echo', 'fail'])
    await expect(registry.listTools('s1')).rejects.toThrow(/not configured/)
    expect(connections).toBe(1)
  })
})

describe('summarizeResult', () => {
  it('joins text blocks and summarizes other content', () => {
    expect(
      summarizeResult({
        content: [
          { type: 'text', text: 'a' },
          { type: 'image', data: '...', mimeType: 'image/png' },
          { type: 'resource', resource: { uri: 'file:///x', text: 'inner' } }
        ]
      })
    ).toEqual({ content: 'a\n[image image/png]\n[resource file:///x]\ninner', isError: false })
  })

  it('falls back to structured content', () => {
    expect(summarizeResult({ content: [], structuredContent: { ok: true } })).toEqual({ content: '{"ok":true}', isError: false })
  })

  it('handles empty and malformed results', () => {
    expect(summarizeResult({})).toEqual({ content: '', isError: false })
    expect(summarizeResult(null)).toEqual({ content: '', isError: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/mcp/registry.test.ts`
Expected: FAIL, cannot find module `./registry`.

- [ ] **Step 3: Implement**

`src/main/mcp/registry.ts`:
```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServerConfig } from '@shared/types'
import type { McpToolInfo } from '../runtime/graph-tools'
import type { ToolRef } from './naming'

export type TransportFactory = (config: McpServerConfig) => Transport

const TOOL_CALL_TIMEOUT_MS = 10 * 60 * 1000
const EXTRA_PATH = ['/usr/local/bin', '/opt/homebrew/bin', `${process.env['HOME'] ?? ''}/.local/bin`, `${process.env['HOME'] ?? ''}/.cargo/bin`]

export function defaultTransportFactory(config: McpServerConfig): Transport {
  if (config.transport === 'stdio') {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) if (typeof value === 'string') env[key] = value
    env['PATH'] = [env['PATH'] ?? '', ...EXTRA_PATH].filter(Boolean).join(':')
    Object.assign(env, config.env ?? {})
    return new StdioClientTransport({ command: config.command, args: config.args, env, stderr: 'pipe' })
  }
  return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } })
}

export interface ToolCallOutcome {
  content: string
  isError: boolean
}

export function summarizeResult(result: unknown): ToolCallOutcome {
  const r = (result && typeof result === 'object' ? result : {}) as {
    content?: unknown
    isError?: unknown
    structuredContent?: unknown
  }
  const texts: string[] = []
  if (Array.isArray(r.content)) {
    for (const block of r.content) {
      if (!block || typeof block !== 'object') continue
      const b = block as { type?: string; text?: unknown; mimeType?: unknown; resource?: { uri?: unknown; text?: unknown } }
      if (b.type === 'text' && typeof b.text === 'string') {
        texts.push(b.text)
      } else if (b.type === 'image' || b.type === 'audio') {
        texts.push(`[${b.type}${typeof b.mimeType === 'string' ? ` ${b.mimeType}` : ''}]`)
      } else if (b.type === 'resource') {
        texts.push(`[resource${typeof b.resource?.uri === 'string' ? ` ${b.resource.uri}` : ''}]`)
        if (typeof b.resource?.text === 'string') texts.push(b.resource.text)
      } else if (typeof b.type === 'string') {
        texts.push(`[${b.type}]`)
      }
    }
  }
  if (texts.length === 0 && r.structuredContent !== undefined) texts.push(JSON.stringify(r.structuredContent))
  return { content: texts.join('\n'), isError: r.isError === true }
}

export class McpRegistry {
  private clients = new Map<string, Promise<Client>>()

  constructor(
    private readonly getConfigs: () => McpServerConfig[],
    private readonly transportFactory: TransportFactory = defaultTransportFactory
  ) {}

  private configFor(serverId: string): McpServerConfig {
    const config = this.getConfigs().find((c) => c.id === serverId)
    if (!config) throw new Error('MCP server is not configured.')
    return config
  }

  private async connect(config: McpServerConfig): Promise<Client> {
    const client = new Client({ name: 'agent-graph', version: '0.1.0' })
    await client.connect(this.transportFactory(config))
    return client
  }

  private clientFor(serverId: string): Promise<Client> {
    const existing = this.clients.get(serverId)
    if (existing) return existing
    const config = this.configFor(serverId)
    const pending = this.connect(config).catch((err: unknown) => {
      this.clients.delete(serverId)
      throw err
    })
    this.clients.set(serverId, pending)
    return pending
  }

  private async toolsOf(client: Client, config: McpServerConfig): Promise<McpToolInfo[]> {
    const { tools } = await client.listTools()
    return tools.map((t) => ({
      serverId: config.id,
      serverName: config.name,
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema as Record<string, unknown>
    }))
  }

  async listTools(serverId: string): Promise<McpToolInfo[]> {
    const config = this.configFor(serverId)
    const client = await this.clientFor(serverId)
    return this.toolsOf(client, config)
  }

  async callTool(ref: ToolRef, args: unknown, signal?: AbortSignal): Promise<ToolCallOutcome> {
    const client = await this.clientFor(ref.serverId)
    const result = await client.callTool(
      { name: ref.toolName, arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown> },
      undefined,
      { signal, timeout: TOOL_CALL_TIMEOUT_MS, resetTimeoutOnProgress: true }
    )
    return summarizeResult(result)
  }

  async test(config: McpServerConfig): Promise<McpToolInfo[]> {
    const client = await this.connect(config)
    try {
      return await this.toolsOf(client, config)
    } finally {
      await client.close().catch(() => undefined)
    }
  }

  async invalidate(serverId: string): Promise<void> {
    const pending = this.clients.get(serverId)
    this.clients.delete(serverId)
    if (!pending) return
    try {
      const client = await pending
      await client.close()
    } catch {
      // already failed or closed
    }
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.clients.keys()]) await this.invalidate(id)
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/main/mcp/registry.test.ts && npm run typecheck`
Expected: all pass; typecheck clean. If `registerTool` complains about the `inputSchema` shape, use `z.object({ text: z.string() })` instead of the raw shape.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/registry.ts src/main/mcp/registry.test.ts
git commit -m "Add MCP client registry with lazy connections

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Settings, secrets, and graph files

**Files:**
- Create: `src/main/fs-utils.ts`, `src/main/settings.ts`, `src/main/secrets.ts`, `src/main/secrets-electron.ts`, `src/main/graph-files.ts`
- Test: `src/main/settings.test.ts`, `src/main/secrets.test.ts`, `src/main/graph-files.test.ts`

**Interfaces:**
- Produces: `writeFileAtomic(path: string, data: string | Buffer): void`; `normalizeSettings(raw: unknown): Settings`; `class SettingsStore { constructor(filePath: string); get(): Settings; update(patch: Partial<Settings>): Settings }`; `interface Cipher { isAvailable(): boolean; encrypt(plain: string): Buffer; decrypt(data: Buffer): string }`; `class SecretStore { constructor(filePath: string, cipher: Cipher); get(name: string): string | null; has(name: string): boolean; set(name: string, value: string): void; clear(name: string): void }`; `electronCipher(): Cipher`; `parseGraphFile(text: string): Graph`; `normalizeGraph(raw: unknown): Graph`; `serializeGraph(graph: Graph): string`.

- [ ] **Step 1: Write the failing tests**

`src/main/settings.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore, normalizeSettings } from './settings'
import { DEFAULT_SETTINGS } from '@shared/types'

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'agent-graph-')), 'nested', 'settings.json')
}

describe('normalizeSettings', () => {
  it('fills defaults for missing or invalid fields', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ theme: 'purple', limits: { maxTurns: 3 }, recentFiles: [1, 'a'] })).toEqual({
      theme: 'dark',
      mcpServers: [],
      limits: { maxTurns: 3, maxDelegationDepth: 5, maxTotalSteps: 200 },
      recentFiles: ['a']
    })
  })
})

describe('SettingsStore', () => {
  it('starts with defaults when no file exists', () => {
    const store = new SettingsStore(tmpFile())
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists updates and reloads them', () => {
    const path = tmpFile()
    const store = new SettingsStore(path)
    const updated = store.update({ theme: 'light', limits: { ...DEFAULT_SETTINGS.limits, maxTurns: 7 } })
    expect(updated.theme).toBe('light')
    expect(updated.limits.maxTurns).toBe(7)
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8')).theme).toBe('light')
    expect(new SettingsStore(path).get()).toEqual(updated)
  })

  it('merges partial limit patches', () => {
    const store = new SettingsStore(tmpFile())
    store.update({ limits: { maxTurns: 1 } as never })
    expect(store.get().limits).toEqual({ maxTurns: 1, maxDelegationDepth: 5, maxTotalSteps: 200 })
  })
})
```

`src/main/secrets.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretStore, type Cipher } from './secrets'

const base64Cipher = (available = true): Cipher => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(Buffer.from(plain, 'utf8').toString('base64')),
  decrypt: (data) => Buffer.from(data.toString('utf8'), 'base64').toString('utf8')
})

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'agent-graph-')), 'secrets.bin')
}

describe('SecretStore', () => {
  it('stores and reads secrets through the cipher', () => {
    const path = tmpFile()
    const store = new SecretStore(path, base64Cipher())
    expect(store.has('anthropic')).toBe(false)
    store.set('anthropic', 'sk-123')
    expect(store.get('anthropic')).toBe('sk-123')
    expect(store.has('anthropic')).toBe(true)
    expect(readFileSync(path, 'utf8')).not.toContain('sk-123')
    expect(new SecretStore(path, base64Cipher()).get('anthropic')).toBe('sk-123')
  })

  it('clears secrets', () => {
    const path = tmpFile()
    const store = new SecretStore(path, base64Cipher())
    store.set('openai', 'x')
    store.clear('openai')
    expect(store.get('openai')).toBeNull()
    store.clear('never-set')
    expect(existsSync(path)).toBe(true)
  })

  it('refuses to store when encryption is unavailable', () => {
    const store = new SecretStore(tmpFile(), base64Cipher(false))
    expect(() => store.set('anthropic', 'k')).toThrow(/not available/)
    expect(store.get('anthropic')).toBeNull()
  })

  it('treats an unreadable file as empty', () => {
    const path = tmpFile()
    const store = new SecretStore(path, {
      isAvailable: () => true,
      encrypt: () => Buffer.from('garbage'),
      decrypt: () => {
        throw new Error('bad')
      }
    })
    store.set('a', 'b')
    expect(new SecretStore(path, base64Cipher()).get('a')).toBeNull()
  })
})
```

`src/main/graph-files.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseGraphFile, serializeGraph, normalizeGraph } from './graph-files'
import { emptyGraph, createAgentNode } from '@shared/graph-defaults'

describe('graph files', () => {
  it('round-trips a graph', () => {
    const g = emptyGraph('Demo')
    g.nodes.push(createAgentNode({ x: 1, y: 2 }, { id: 'a', name: 'A', tools: [{ serverId: 's', names: ['x'] }], temperature: 0.5 }))
    g.entryNodeId = 'a'
    const text = serializeGraph(g)
    expect(text.endsWith('\n')).toBe(true)
    expect(parseGraphFile(text)).toEqual(g)
  })

  it('rejects invalid JSON and wrong versions', () => {
    expect(() => parseGraphFile('{')).toThrow(/valid JSON/)
    expect(() => parseGraphFile('{"version":2,"nodes":[],"edges":[]}')).toThrow(/version/)
    expect(() => parseGraphFile('[]')).toThrow()
    expect(() => parseGraphFile('{"version":1}')).toThrow(/nodes or edges/)
  })

  it('fills defaults and drops malformed pieces', () => {
    const g = normalizeGraph({
      version: 1,
      name: '',
      entryNodeId: 'missing',
      nodes: [{ id: 'n1', provider: 'martian', tools: [{ serverId: 's', names: '*' }, { bad: true }, { serverId: 's2', names: ['a', 3] }] }],
      edges: [{ id: 'e1', source: 'n1', target: 'n1', kind: 'weird' }, { source: 'x' }]
    })
    expect(g.name).toBe('Untitled')
    expect(g.entryNodeId).toBeNull()
    expect(g.nodes[0]).toEqual({
      id: 'n1',
      name: 'Agent',
      position: { x: 0, y: 0 },
      provider: 'anthropic',
      model: 'claude-opus-5',
      instructions: '',
      tools: [
        { serverId: 's', names: '*' },
        { serverId: 's2', names: ['a'] }
      ]
    })
    expect(g.edges).toEqual([{ id: 'e1', source: 'n1', target: 'n1', kind: 'handoff' }])
  })

  it('requires node ids', () => {
    expect(() => normalizeGraph({ version: 1, nodes: [{ name: 'x' }], edges: [] })).toThrow(/id/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/settings.test.ts src/main/secrets.test.ts src/main/graph-files.test.ts`
Expected: FAIL, cannot find modules.

- [ ] **Step 3: Implement**

`src/main/fs-utils.ts`:
```ts
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function writeFileAtomic(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}
```

`src/main/settings.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs'
import { DEFAULT_SETTINGS, type McpServerConfig, type Settings } from '@shared/types'
import { writeFileAtomic } from './fs-utils'

function isServerConfig(value: unknown): value is McpServerConfig {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v['id'] !== 'string' || typeof v['name'] !== 'string') return false
  if (v['transport'] === 'stdio') return typeof v['command'] === 'string' && Array.isArray(v['args'])
  if (v['transport'] === 'http') return typeof v['url'] === 'string'
  return false
}

export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>
  const limits = (r.limits && typeof r.limits === 'object' ? r.limits : {}) as Partial<Settings['limits']>
  const pick = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
  return {
    theme: r.theme === 'light' ? 'light' : 'dark',
    mcpServers: Array.isArray(r.mcpServers) ? r.mcpServers.filter(isServerConfig) : [],
    limits: {
      maxTurns: pick(limits.maxTurns, DEFAULT_SETTINGS.limits.maxTurns),
      maxDelegationDepth: pick(limits.maxDelegationDepth, DEFAULT_SETTINGS.limits.maxDelegationDepth),
      maxTotalSteps: pick(limits.maxTotalSteps, DEFAULT_SETTINGS.limits.maxTotalSteps)
    },
    recentFiles: Array.isArray(r.recentFiles) ? r.recentFiles.filter((f): f is string => typeof f === 'string') : []
  }
}

export class SettingsStore {
  private settings: Settings

  constructor(private readonly filePath: string) {
    this.settings = this.load()
  }

  private load(): Settings {
    if (!existsSync(this.filePath)) return normalizeSettings({})
    try {
      return normalizeSettings(JSON.parse(readFileSync(this.filePath, 'utf8')))
    } catch {
      return normalizeSettings({})
    }
  }

  get(): Settings {
    return this.settings
  }

  update(patch: Partial<Settings>): Settings {
    this.settings = normalizeSettings({
      ...this.settings,
      ...patch,
      limits: { ...this.settings.limits, ...(patch.limits ?? {}) }
    })
    writeFileAtomic(this.filePath, JSON.stringify(this.settings, null, 2))
    return this.settings
  }
}
```

`src/main/secrets.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs'
import { writeFileAtomic } from './fs-utils'

export interface Cipher {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

const UNAVAILABLE = 'Secure storage is not available on this system, so API keys cannot be saved.'

export class SecretStore {
  private cache: Record<string, string> | null = null

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher
  ) {}

  private read(): Record<string, string> {
    if (this.cache) return this.cache
    let map: Record<string, string> = {}
    if (existsSync(this.filePath) && this.cipher.isAvailable()) {
      try {
        const parsed: unknown = JSON.parse(this.cipher.decrypt(readFileSync(this.filePath)))
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') map[k] = v
        }
      } catch {
        map = {}
      }
    }
    this.cache = map
    return map
  }

  private write(map: Record<string, string>): void {
    if (!this.cipher.isAvailable()) throw new Error(UNAVAILABLE)
    writeFileAtomic(this.filePath, this.cipher.encrypt(JSON.stringify(map)))
    this.cache = map
  }

  get(name: string): string | null {
    return this.read()[name] ?? null
  }

  has(name: string): boolean {
    return this.get(name) !== null
  }

  set(name: string, value: string): void {
    this.write({ ...this.read(), [name]: value })
  }

  clear(name: string): void {
    const map = { ...this.read() }
    delete map[name]
    this.write(map)
  }
}
```

`src/main/secrets-electron.ts`:
```ts
import { safeStorage } from 'electron'
import type { Cipher } from './secrets'

export function electronCipher(): Cipher {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data)
  }
}
```

`src/main/graph-files.ts`:
```ts
import { DEFAULT_MODELS, PROVIDER_IDS, type AgentNode, type Graph, type GraphEdge, type ProviderId, type ToolGrant } from '@shared/types'

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeGrant(raw: unknown): ToolGrant[] {
  if (!raw || typeof raw !== 'object') return []
  const r = raw as Record<string, unknown>
  const serverId = str(r['serverId'])
  if (!serverId) return []
  if (r['names'] === '*') return [{ serverId, names: '*' }]
  if (Array.isArray(r['names'])) return [{ serverId, names: r['names'].filter((n): n is string => typeof n === 'string') }]
  return []
}

function normalizeNode(raw: unknown, index: number): AgentNode {
  if (!raw || typeof raw !== 'object') throw new Error(`Node ${index + 1} is malformed.`)
  const r = raw as Record<string, unknown>
  const id = str(r['id'])
  if (!id) throw new Error(`Node ${index + 1} has no id.`)
  const provider: ProviderId = PROVIDER_IDS.includes(r['provider'] as ProviderId) ? (r['provider'] as ProviderId) : 'anthropic'
  const pos = (r['position'] && typeof r['position'] === 'object' ? r['position'] : {}) as Record<string, unknown>
  const node: AgentNode = {
    id,
    name: str(r['name']) ?? 'Agent',
    position: { x: num(pos['x']) ?? 0, y: num(pos['y']) ?? 0 },
    provider,
    model: str(r['model']) ?? DEFAULT_MODELS[provider],
    instructions: str(r['instructions']) ?? '',
    tools: Array.isArray(r['tools']) ? r['tools'].flatMap(normalizeGrant) : []
  }
  const temperature = num(r['temperature'])
  const maxTokens = num(r['maxTokens'])
  const maxTurns = num(r['maxTurns'])
  if (temperature !== undefined) node.temperature = temperature
  if (maxTokens !== undefined) node.maxTokens = maxTokens
  if (maxTurns !== undefined) node.maxTurns = maxTurns
  return node
}

function normalizeEdge(raw: unknown): GraphEdge | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r['id'])
  const source = str(r['source'])
  const target = str(r['target'])
  if (!id || !source || !target) return null
  const edge: GraphEdge = { id, source, target, kind: r['kind'] === 'delegate' ? 'delegate' : 'handoff' }
  const description = str(r['description'])
  if (description) edge.description = description
  return edge
}

export function normalizeGraph(raw: unknown): Graph {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The file does not contain a graph.')
  const r = raw as Record<string, unknown>
  if (r['version'] !== 1) throw new Error(`Unsupported graph version: ${String(r['version'])}.`)
  if (!Array.isArray(r['nodes']) || !Array.isArray(r['edges'])) throw new Error('The graph is missing nodes or edges.')
  const nodes = r['nodes'].map(normalizeNode)
  const edges = r['edges'].map(normalizeEdge).filter((e): e is GraphEdge => e !== null)
  const entry = str(r['entryNodeId'])
  const name = str(r['name'])
  return {
    version: 1,
    name: name && name.trim() ? name : 'Untitled',
    entryNodeId: entry && nodes.some((n) => n.id === entry) ? entry : null,
    nodes,
    edges
  }
}

export function parseGraphFile(text: string): Graph {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  return normalizeGraph(raw)
}

export function serializeGraph(graph: Graph): string {
  return JSON.stringify(graph, null, 2) + '\n'
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/main/settings.test.ts src/main/secrets.test.ts src/main/graph-files.test.ts && npm run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/fs-utils.ts src/main/settings.ts src/main/settings.test.ts src/main/secrets.ts src/main/secrets.test.ts src/main/secrets-electron.ts src/main/graph-files.ts src/main/graph-files.test.ts
git commit -m "Add settings, encrypted secrets, and graph file persistence

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Main process wiring, IPC handlers, preload bridge

**Files:**
- Create: `src/main/ipc.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`

**Interfaces:**
- Consumes: `SettingsStore`, `SecretStore`, `electronCipher`, `McpRegistry`, `parseGraphFile`, `serializeGraph`, `writeFileAtomic`, `getProvider`, `listModelsWithFallback`, `runGraph`, `errorMessage`, `EngineDeps`, `McpToolInfo`, `IPC`, `Api`.
- Produces: `registerIpc(ctx: MainContext)`, `interface MainContext { settings: SettingsStore; secrets: SecretStore; mcp: McpRegistry; getWindow: () => BrowserWindow | null }`; `window.api` implementing `Api` in the renderer.

- [ ] **Step 1: Write the IPC module**

`src/main/ipc.ts`:
```ts
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { IPC, type McpToolListResult, type McpToolSummary, type OpenedGraph } from '@shared/ipc'
import type { Graph, McpServerConfig, ProviderId, Settings, ToolGrant } from '@shared/types'
import type { RunEvent } from '@shared/events'
import type { SettingsStore } from './settings'
import type { SecretStore } from './secrets'
import type { McpRegistry } from './mcp/registry'
import { parseGraphFile, serializeGraph } from './graph-files'
import { getProvider, listModelsWithFallback } from './providers'
import { errorMessage, runGraph, type EngineDeps } from './runtime/engine'
import type { McpToolInfo } from './runtime/graph-tools'
import { writeFileAtomic } from './fs-utils'

export interface MainContext {
  settings: SettingsStore
  secrets: SecretStore
  mcp: McpRegistry
  getWindow: () => BrowserWindow | null
}

const GRAPH_FILTERS = [{ name: 'Agent Graph', extensions: ['json'] }]
const MAX_RECENT = 10

function safeFileName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '-')
  return cleaned || 'graph'
}

function rememberRecent(settings: SettingsStore, path: string): void {
  const recent = [path, ...settings.get().recentFiles.filter((p) => p !== path)].slice(0, MAX_RECENT)
  settings.update({ recentFiles: recent })
}

function summary(tool: McpToolInfo): McpToolSummary {
  return { name: tool.name, description: tool.description }
}

async function collectMcpTools(ctx: MainContext, grants: ToolGrant[]): Promise<{ tools: McpToolInfo[]; warnings: string[] }> {
  const tools: McpToolInfo[] = []
  const warnings: string[] = []
  const configured = ctx.settings.get().mcpServers
  for (const serverId of new Set(grants.map((g) => g.serverId))) {
    const config = configured.find((s) => s.id === serverId)
    if (!config) {
      warnings.push('A node references an MCP server that is no longer configured; its tools were skipped.')
      continue
    }
    try {
      tools.push(...(await ctx.mcp.listTools(serverId)))
    } catch (err) {
      warnings.push(`Could not connect to MCP server "${config.name}": ${errorMessage(err)}`)
    }
  }
  return { tools, warnings }
}

export function registerIpc(ctx: MainContext): void {
  const runs = new Map<string, AbortController>()

  ipcMain.handle(IPC.openGraph, async (): Promise<OpenedGraph | null> => {
    const win = ctx.getWindow()
    const options = { properties: ['openFile' as const], filters: GRAPH_FILTERS }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    const graph = parseGraphFile(await readFile(path, 'utf8'))
    rememberRecent(ctx.settings, path)
    return { path, graph }
  })

  ipcMain.handle(IPC.saveGraph, async (_event, graph: Graph, path: string | null): Promise<string | null> => {
    let target = path
    if (!target) {
      const win = ctx.getWindow()
      const options = { defaultPath: `${safeFileName(graph.name)}.agentgraph.json`, filters: GRAPH_FILTERS }
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      target = result.filePath
    }
    writeFileAtomic(target, serializeGraph(graph))
    rememberRecent(ctx.settings, target)
    return target
  })

  ipcMain.handle(IPC.getSettings, () => ctx.settings.get())

  ipcMain.handle(IPC.updateSettings, (_event, patch: Partial<Settings>) => {
    const before = ctx.settings.get()
    const after = ctx.settings.update(patch)
    for (const old of before.mcpServers) {
      const now = after.mcpServers.find((s) => s.id === old.id)
      if (!now || JSON.stringify(now) !== JSON.stringify(old)) void ctx.mcp.invalidate(old.id)
    }
    return after
  })

  ipcMain.handle(IPC.setSecret, (_event, provider: ProviderId, key: string) => {
    ctx.secrets.set(provider, key.trim())
  })
  ipcMain.handle(IPC.hasSecret, (_event, provider: ProviderId) => ctx.secrets.has(provider))
  ipcMain.handle(IPC.clearSecret, (_event, provider: ProviderId) => {
    ctx.secrets.clear(provider)
  })

  ipcMain.handle(IPC.listModels, (_event, provider: ProviderId) => listModelsWithFallback(provider, ctx.secrets.get(provider)))

  ipcMain.handle(IPC.testMcp, async (_event, config: McpServerConfig): Promise<McpToolListResult> => {
    try {
      const tools = await ctx.mcp.test(config)
      return { ok: true, tools: tools.map(summary) }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle(IPC.listMcpTools, async (_event, serverId: string): Promise<McpToolListResult> => {
    try {
      const tools = await ctx.mcp.listTools(serverId)
      return { ok: true, tools: tools.map(summary) }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle(IPC.startRun, (event, graph: Graph, input: string): string => {
    const runId = globalThis.crypto.randomUUID()
    const controller = new AbortController()
    runs.set(runId, controller)
    const sender = event.sender
    const emit = (e: RunEvent): void => {
      if (!sender.isDestroyed()) sender.send(IPC.runEvent, e)
    }
    const deps: EngineDeps = {
      getProvider,
      getApiKey: async (id) => ctx.secrets.get(id),
      listMcpTools: (grants) => collectMcpTools(ctx, grants),
      callMcpTool: (ref, args, signal) => ctx.mcp.callTool(ref, args, signal),
      limits: ctx.settings.get().limits,
      emit
    }
    void runGraph({ runId, graph, input, signal: controller.signal, deps }).finally(() => runs.delete(runId))
    return runId
  })

  ipcMain.handle(IPC.stopRun, (_event, runId: string) => {
    runs.get(runId)?.abort()
  })
}
```

- [ ] **Step 2: Replace the main entry**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { Theme } from '@shared/types'
import { SettingsStore } from './settings'
import { SecretStore } from './secrets'
import { electronCipher } from './secrets-electron'
import { McpRegistry } from './mcp/registry'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null

function createWindow(theme: Theme): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: theme === 'dark' ? '#0e0e0e' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  const userData = app.getPath('userData')
  const settings = new SettingsStore(join(userData, 'settings.json'))
  const secrets = new SecretStore(join(userData, 'secrets.bin'), electronCipher())
  const mcp = new McpRegistry(() => settings.get().mcpServers)

  registerIpc({ settings, secrets, mcp, getWindow: () => mainWindow })
  createWindow(settings.get().theme)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(settings.get().theme)
  })
  app.on('before-quit', () => {
    void mcp.closeAll()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 3: Replace the preload bridge**

`src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type Api } from '@shared/ipc'
import type { RunEvent } from '@shared/events'

const api: Api = {
  openGraph: () => ipcRenderer.invoke(IPC.openGraph),
  saveGraph: (graph, path) => ipcRenderer.invoke(IPC.saveGraph, graph, path),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  setSecret: (provider, key) => ipcRenderer.invoke(IPC.setSecret, provider, key),
  hasSecret: (provider) => ipcRenderer.invoke(IPC.hasSecret, provider),
  clearSecret: (provider) => ipcRenderer.invoke(IPC.clearSecret, provider),
  listModels: (provider) => ipcRenderer.invoke(IPC.listModels, provider),
  testMcpServer: (config) => ipcRenderer.invoke(IPC.testMcp, config),
  listMcpTools: (serverId) => ipcRenderer.invoke(IPC.listMcpTools, serverId),
  startRun: (graph, input) => ipcRenderer.invoke(IPC.startRun, graph, input),
  stopRun: (runId) => ipcRenderer.invoke(IPC.stopRun, runId),
  onRunEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, event: RunEvent): void => listener(event)
    ipcRenderer.on(IPC.runEvent, handler)
    return () => {
      ipcRenderer.removeListener(IPC.runEvent, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build && npm test`
Expected: typecheck clean, build succeeds, all existing tests pass.

Then run: `timeout 20 npx electron-vite dev 2>&1 | tail -20` (or start `npm run dev` in the background and stop it after the window appears).
Expected: the app window opens with "Agent Graph" text and no errors in the terminal about the preload or main bundle. If `timeout` is unavailable on macOS, use `npx electron-vite dev & sleep 15; kill %1`.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts src/preload/index.ts
git commit -m "Wire main process: IPC handlers, run manager, preload bridge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Renderer theme, styles, and stores

**Files:**
- Create: `src/renderer/styles/theme.css`, `src/renderer/styles/app.css`, `src/renderer/lib/errors.ts`, `src/renderer/store/ui.ts`, `src/renderer/store/graph.ts`, `src/renderer/store/run.ts`
- Test: `src/renderer/store/graph.test.ts`, `src/renderer/store/run.test.ts`

**Interfaces:**
- Consumes: `Graph`, `AgentNode`, `GraphEdge`, `EdgeKind`, `Settings`, `Theme`, `ProviderId` from `@shared/types`; `createAgentNode`, `emptyGraph`, `newId` from `@shared/graph-defaults`; `RunEvent`; `McpToolSummary`, `ModelListResult` from `@shared/ipc`.
- Produces:
  - `useUiStore` with state `{ settings: Settings | null; selection: Selection; settingsOpen: boolean; consoleOpen: boolean; consoleHeight: number; modelCache: Partial<Record<ProviderId, ModelListResult>>; toolCache: Record<string, ToolCacheEntry> }` and actions `loadSettings()`, `updateSettings(patch)`, `setTheme(theme)`, `select(selection)`, `setSettingsOpen(open)`, `setConsoleOpen(open)`, `setConsoleHeight(h)`, `fetchModels(provider, force?)`, `fetchTools(serverId, force?)`; `type Selection = { type: 'node'; id: string } | { type: 'edge'; id: string } | null`; `interface ToolCacheEntry { status: 'loading' | 'ready' | 'error'; tools: McpToolSummary[]; error?: string }`; `applyTheme(theme)`.
  - `useGraphStore` with state `{ graph: Graph; path: string | null; dirty: boolean }` and actions `setGraph(graph, path)`, `newGraph()`, `setName(name)`, `addNode(position): AgentNode`, `updateNode(id, patch)`, `moveNode(id, position)`, `removeNodes(ids)`, `duplicateNode(id): AgentNode | null`, `addEdge(source, target, kind?): GraphEdge | null`, `updateEdge(id, patch)`, `removeEdges(ids)`, `setEntry(id)`, `markSaved(path)`.
  - `useRunStore` with `RunState` fields plus `handleEvent(event)`, `reset()`; pure `applyRunEvent(state, event): RunState`; `initialRunState`; types `NodeStatus`, `ToolCallView`, `MarkerView`, `ExecutionView`, `RunState`.
  - `describeError(err: unknown): string`.

- [ ] **Step 1: Write the failing store tests**

`src/renderer/store/graph.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphStore } from './graph'
import { emptyGraph } from '@shared/graph-defaults'

const s = () => useGraphStore.getState()

beforeEach(() => {
  s().newGraph()
})

describe('graph store', () => {
  it('starts clean and empty', () => {
    expect(s().graph).toEqual(emptyGraph())
    expect(s().dirty).toBe(false)
    expect(s().path).toBeNull()
  })

  it('adds nodes and marks the first one as entry', () => {
    const a = s().addNode({ x: 1, y: 2 })
    const b = s().addNode({ x: 3, y: 4 })
    expect(s().graph.nodes.map((n) => n.id)).toEqual([a.id, b.id])
    expect(s().graph.entryNodeId).toBe(a.id)
    expect(s().dirty).toBe(true)
  })

  it('updates and moves nodes', () => {
    const a = s().addNode({ x: 0, y: 0 })
    s().updateNode(a.id, { name: 'Router', model: 'x' })
    s().moveNode(a.id, { x: 9, y: 9 })
    expect(s().graph.nodes[0]).toMatchObject({ name: 'Router', model: 'x', position: { x: 9, y: 9 } })
  })

  it('connects nodes, rejects duplicates, and flips kinds', () => {
    const a = s().addNode({ x: 0, y: 0 })
    const b = s().addNode({ x: 0, y: 0 })
    const e = s().addEdge(a.id, b.id)
    expect(e).toMatchObject({ source: a.id, target: b.id, kind: 'handoff' })
    expect(s().addEdge(a.id, b.id)).toBeNull()
    expect(s().addEdge(a.id, b.id, 'delegate')).not.toBeNull()
    expect(s().addEdge(a.id, 'ghost')).toBeNull()
    s().updateEdge(e!.id, { kind: 'delegate', description: 'd' })
    expect(s().graph.edges[0]).toMatchObject({ kind: 'delegate', description: 'd' })
  })

  it('removes nodes with their edges and clears the entry', () => {
    const a = s().addNode({ x: 0, y: 0 })
    const b = s().addNode({ x: 0, y: 0 })
    s().addEdge(a.id, b.id)
    s().removeNodes([a.id])
    expect(s().graph.nodes.map((n) => n.id)).toEqual([b.id])
    expect(s().graph.edges).toEqual([])
    expect(s().graph.entryNodeId).toBeNull()
  })

  it('removes edges and sets entry', () => {
    const a = s().addNode({ x: 0, y: 0 })
    const b = s().addNode({ x: 0, y: 0 })
    const e = s().addEdge(a.id, b.id)!
    s().removeEdges([e.id])
    expect(s().graph.edges).toEqual([])
    s().setEntry(b.id)
    expect(s().graph.entryNodeId).toBe(b.id)
  })

  it('duplicates a node with an offset and a new id', () => {
    const a = s().addNode({ x: 10, y: 10 })
    s().updateNode(a.id, { name: 'Orig', instructions: 'i' })
    const copy = s().duplicateNode(a.id)!
    expect(copy.id).not.toBe(a.id)
    expect(copy).toMatchObject({ name: 'Orig copy', instructions: 'i', position: { x: 50, y: 50 } })
    expect(s().duplicateNode('ghost')).toBeNull()
  })

  it('tracks path and dirty state through save and load', () => {
    s().addNode({ x: 0, y: 0 })
    s().markSaved('/tmp/a.json')
    expect(s().dirty).toBe(false)
    expect(s().path).toBe('/tmp/a.json')
    s().setName('Renamed')
    expect(s().dirty).toBe(true)
    const g = emptyGraph('Loaded')
    s().setGraph(g, '/tmp/b.json')
    expect(s().graph.name).toBe('Loaded')
    expect(s().path).toBe('/tmp/b.json')
    expect(s().dirty).toBe(false)
  })
})
```

`src/renderer/store/run.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { applyRunEvent, initialRunState, type RunState } from './run'
import type { RunEvent } from '@shared/events'

function play(events: RunEvent[]): RunState {
  return events.reduce(applyRunEvent, initialRunState)
}

describe('applyRunEvent', () => {
  it('builds executions from events', () => {
    const state = play([
      { type: 'run.started', runId: 'r' },
      { type: 'node.started', runId: 'r', executionId: 'x1', nodeId: 'a', parentExecutionId: null, input: 'hi', depth: 0 },
      { type: 'node.text', runId: 'r', executionId: 'x1', delta: 'Hel' },
      { type: 'node.text', runId: 'r', executionId: 'x1', delta: 'lo' },
      { type: 'node.tool.call', runId: 'r', executionId: 'x1', callId: 'c1', name: 'read', args: { p: 1 } },
      { type: 'node.tool.result', runId: 'r', executionId: 'x1', callId: 'c1', content: 'data', isError: false },
      { type: 'edge.traversed', runId: 'r', fromExecutionId: 'x1', edgeId: 'e1', kind: 'handoff', message: 'next' },
      { type: 'node.finished', runId: 'r', executionId: 'x1', output: 'Hello' },
      { type: 'run.finished', runId: 'r', output: 'Hello' }
    ])
    expect(state.status).toBe('finished')
    expect(state.output).toBe('Hello')
    expect(state.executions).toHaveLength(1)
    expect(state.executions[0]).toMatchObject({
      nodeId: 'a',
      text: 'Hello',
      status: 'done',
      output: 'Hello',
      toolCalls: [{ callId: 'c1', name: 'read', args: { p: 1 }, result: 'data', isError: false }],
      markers: [{ kind: 'handoff', edgeId: 'e1', message: 'next' }]
    })
    expect(state.traversedEdgeIds).toEqual(['e1'])
    expect(state.nodeStatus).toEqual({ a: 'done' })
  })

  it('records errors, warnings, and cancellation', () => {
    const errored = play([
      { type: 'run.started', runId: 'r' },
      { type: 'run.warning', runId: 'r', message: 'w' },
      { type: 'node.started', runId: 'r', executionId: 'x1', nodeId: 'a', parentExecutionId: null, input: '', depth: 0 },
      { type: 'node.error', runId: 'r', executionId: 'x1', error: 'bad' },
      { type: 'run.error', runId: 'r', error: 'bad' }
    ])
    expect(errored.status).toBe('error')
    expect(errored.error).toBe('bad')
    expect(errored.warnings).toEqual(['w'])
    expect(errored.executions[0]).toMatchObject({ status: 'error', error: 'bad' })
    expect(errored.nodeStatus).toEqual({ a: 'error' })

    const cancelled = play([{ type: 'run.started', runId: 'r' }, { type: 'run.cancelled', runId: 'r' }])
    expect(cancelled.status).toBe('cancelled')
  })

  it('ignores events from other runs and resets on a new run', () => {
    const state = play([
      { type: 'run.started', runId: 'r1' },
      { type: 'node.started', runId: 'r1', executionId: 'x1', nodeId: 'a', parentExecutionId: null, input: '', depth: 0 },
      { type: 'run.started', runId: 'r2' },
      { type: 'node.text', runId: 'r1', executionId: 'x1', delta: 'stale' }
    ])
    expect(state.runId).toBe('r2')
    expect(state.executions).toEqual([])
    expect(state.status).toBe('running')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/store`
Expected: FAIL, cannot find modules.

- [ ] **Step 3: Write the theme and app styles**

`src/renderer/styles/theme.css`:
```css
:root {
  --bg: #ffffff;
  --surface: #fafafa;
  --surface-2: #f0f0f0;
  --border: #e3e3e3;
  --border-strong: #bcbcbc;
  --text: #111111;
  --text-muted: #6b6b6b;
  --text-faint: #a6a6a6;
  --inverse-bg: #111111;
  --inverse-text: #ffffff;
  --edge: #8f8f8f;
  --edge-active: #111111;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 8px 24px rgba(0, 0, 0, 0.08);
  --radius: 6px;
  --font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;
  --mono: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
  color-scheme: light;
}

:root[data-theme='dark'] {
  --bg: #0e0e0e;
  --surface: #151515;
  --surface-2: #1f1f1f;
  --border: #272727;
  --border-strong: #454545;
  --text: #f2f2f2;
  --text-muted: #9b9b9b;
  --text-faint: #5a5a5a;
  --inverse-bg: #f2f2f2;
  --inverse-text: #0e0e0e;
  --edge: #6f6f6f;
  --edge-active: #f2f2f2;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.5), 0 8px 24px rgba(0, 0, 0, 0.55);
  color-scheme: dark;
}
```

`src/renderer/styles/app.css`:
```css
* {
  box-sizing: border-box;
}
html,
body,
#root {
  height: 100%;
  margin: 0;
}
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 13px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
  user-select: none;
}
button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
}
input,
textarea {
  user-select: text;
}
::selection {
  background: var(--text);
  color: var(--bg);
}

/* Layout */
.app {
  display: grid;
  grid-template-rows: 40px 1fr auto;
  grid-template-columns: 1fr auto;
  height: 100vh;
}
.topbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 0 84px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  -webkit-app-region: drag;
}
.topbar > * {
  -webkit-app-region: no-drag;
}
.canvas {
  position: relative;
  grid-row: 2;
  grid-column: 1;
  min-width: 0;
  min-height: 0;
}
.inspector {
  grid-row: 2;
  grid-column: 2;
  width: 320px;
  border-left: 1px solid var(--border);
  background: var(--surface);
  overflow-y: auto;
}
.console {
  grid-row: 3;
  grid-column: 1 / -1;
  border-top: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  position: relative;
}
.console-resize {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  cursor: row-resize;
}
.spacer {
  flex: 1;
}

/* Controls */
.btn {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.btn:hover {
  background: var(--surface-2);
}
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.btn-primary {
  background: var(--inverse-bg);
  color: var(--inverse-text);
  border-color: var(--inverse-bg);
}
.btn-primary:hover {
  background: var(--inverse-bg);
  opacity: 0.85;
}
.btn-ghost {
  border-color: transparent;
}
.btn-icon {
  width: 26px;
  padding: 0;
  justify-content: center;
}
.btn-small {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
}
.input,
.textarea,
.select {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  padding: 5px 8px;
  outline: none;
}
.input:focus,
.textarea:focus,
.select:focus {
  border-color: var(--border-strong);
}
.textarea {
  font-family: var(--mono);
  font-size: 12px;
  min-height: 140px;
  resize: vertical;
  line-height: 1.5;
}
.select {
  appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, var(--text-muted) 50%),
    linear-gradient(135deg, var(--text-muted) 50%, transparent 50%);
  background-position: calc(100% - 14px) 12px, calc(100% - 10px) 12px;
  background-size: 4px 4px;
  background-repeat: no-repeat;
  padding-right: 24px;
}
input[type='checkbox'] {
  accent-color: var(--text);
  margin: 0;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.segmented {
  display: inline-flex;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  overflow: hidden;
}
.segmented button {
  border: 0;
  background: transparent;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
}
.segmented button.active {
  background: var(--inverse-bg);
  color: var(--inverse-text);
}
.muted {
  color: var(--text-muted);
}
.faint {
  color: var(--text-faint);
}
.small {
  font-size: 11px;
}
.mono {
  font-family: var(--mono);
}
.error-text {
  font-size: 11px;
  color: var(--text);
  border-left: 2px solid var(--text);
  padding-left: 8px;
}
.kbd {
  font-size: 10px;
  color: var(--text-faint);
}

/* Top bar */
.topbar-name {
  border: 0;
  background: transparent;
  font-weight: 600;
  width: 220px;
  padding: 4px 6px;
  border-radius: 4px;
  outline: none;
}
.topbar-name:focus {
  background: var(--surface-2);
}
.dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
}

/* Canvas and nodes */
.react-flow {
  background: var(--bg);
}
.react-flow__handle {
  width: 8px;
  height: 8px;
  background: var(--bg);
  border: 1px solid var(--text);
}
.react-flow__edge-path {
  stroke: var(--edge);
  stroke-width: 1.5;
}
.react-flow__edge.selected .react-flow__edge-path,
.react-flow__edge:hover .react-flow__edge-path {
  stroke: var(--edge-active);
}
.react-flow__edge-path.traversed {
  stroke: var(--edge-active);
  stroke-width: 2;
}
.react-flow__connectionline path {
  stroke: var(--edge-active);
}
.react-flow__attribution {
  background: transparent;
}
.react-flow__attribution a {
  color: var(--text-faint);
}
.react-flow__controls {
  box-shadow: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.react-flow__controls-button {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  fill: var(--text);
}
.react-flow__controls-button:hover {
  background: var(--surface-2);
}
.react-flow__node.selected .agent-node {
  border-color: var(--text);
  box-shadow: 0 0 0 1px var(--text), var(--shadow);
}
.agent-node {
  width: 220px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface);
  padding: 10px 12px;
  box-shadow: var(--shadow);
  transition: border-color 0.15s;
}
.agent-node-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.agent-node-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  font-size: 9px;
  letter-spacing: 0.08em;
  padding: 2px 5px;
  border: 1px solid var(--text);
  border-radius: 3px;
  flex-shrink: 0;
}
.agent-node-meta {
  color: var(--text-muted);
  font-size: 11px;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-node-foot {
  color: var(--text-faint);
  font-size: 11px;
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.agent-node.status-running {
  border-color: var(--text);
  animation: pulse 1.2s ease-in-out infinite;
}
.agent-node.status-error {
  border-style: dashed;
  border-color: var(--text);
}
@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(127, 127, 127, 0), var(--shadow);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(127, 127, 127, 0.3), var(--shadow);
  }
}
.edge-label {
  position: absolute;
  pointer-events: all;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 10px;
  color: var(--text-muted);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.canvas-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  pointer-events: none;
  font-size: 13px;
}

/* Context menu */
.context-menu {
  position: fixed;
  z-index: 60;
  min-width: 160px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 4px;
}
.context-menu button {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
}
.context-menu button:hover {
  background: var(--surface-2);
}

/* Inspector */
.inspector-section {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.inspector-title {
  font-weight: 600;
  margin-bottom: 10px;
}
.inspector-empty {
  padding: 24px 16px;
  color: var(--text-faint);
  text-align: center;
}
.server-block {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 8px;
}
.server-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}
.server-head .grow {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.server-tools {
  border-top: 1px solid var(--border);
  padding: 6px 10px 8px;
  max-height: 220px;
  overflow-y: auto;
}
.tool-check {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 3px 0;
  cursor: pointer;
}
.tool-check input {
  margin-top: 3px;
}
.combo {
  position: relative;
}
.combo-list {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  z-index: 20;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  max-height: 220px;
  overflow-y: auto;
  margin-top: 2px;
}
.combo-list button {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 5px 8px;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.combo-list button:hover {
  background: var(--surface-2);
}

/* Console */
.console-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.console-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  font-family: var(--mono);
  font-size: 12px;
  user-select: text;
}
.console-input {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  align-items: flex-end;
}
.console-input textarea {
  flex: 1;
  min-height: 34px;
  max-height: 140px;
  resize: none;
}
.exec {
  margin-bottom: 14px;
  padding-left: calc(var(--depth) * 18px);
}
.exec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.exec-input {
  color: var(--text-faint);
  white-space: pre-wrap;
  margin-top: 2px;
}
.exec-text {
  white-space: pre-wrap;
  margin-top: 4px;
}
.tool-row {
  margin-top: 6px;
  border-left: 2px solid var(--border-strong);
  padding-left: 8px;
  color: var(--text-muted);
}
.tool-row.error {
  border-left-color: var(--text);
}
.tool-row summary {
  cursor: pointer;
  list-style: none;
}
.tool-row summary::-webkit-details-marker {
  display: none;
}
.tool-row pre {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
  color: var(--text);
}
.marker {
  margin-top: 6px;
  color: var(--text-muted);
  font-style: italic;
}
.exec-error {
  margin-top: 6px;
  border-left: 2px solid var(--text);
  padding-left: 8px;
}
.run-output {
  border-top: 1px solid var(--border);
  padding-top: 10px;
  margin-top: 10px;
  white-space: pre-wrap;
}
.warning-line {
  color: var(--text-muted);
  margin-bottom: 6px;
}

/* Dialog */
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.dialog {
  width: 660px;
  max-height: 80vh;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
}
.dialog-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 16px 0;
  border-bottom: 1px solid var(--border);
}
.dialog-tabs button {
  border: 0;
  background: transparent;
  padding: 6px 10px;
  cursor: pointer;
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.dialog-tabs button.active {
  color: var(--text);
  border-bottom-color: var(--text);
}
.dialog-body {
  padding: 16px;
  overflow-y: auto;
}
.list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 6px;
}
.list-item .grow {
  flex: 1;
  min-width: 0;
}
```

- [ ] **Step 4: Write the error helper and stores**

`src/renderer/lib/errors.ts`:
```ts
/** Turns any thrown value into a message, stripping Electron's IPC prefix. */
export function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
```

`src/renderer/store/ui.ts`:
```ts
import { create } from 'zustand'
import type { ProviderId, Settings, Theme } from '@shared/types'
import type { McpToolSummary, ModelListResult } from '@shared/ipc'
import { describeError } from '@/lib/errors'

export type Selection = { type: 'node'; id: string } | { type: 'edge'; id: string } | null

export interface ToolCacheEntry {
  status: 'loading' | 'ready' | 'error'
  tools: McpToolSummary[]
  error?: string
}

interface UiState {
  settings: Settings | null
  selection: Selection
  settingsOpen: boolean
  consoleOpen: boolean
  consoleHeight: number
  modelCache: Partial<Record<ProviderId, ModelListResult>>
  toolCache: Record<string, ToolCacheEntry>
  loadSettings(): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  setTheme(theme: Theme): Promise<void>
  select(selection: Selection): void
  setSettingsOpen(open: boolean): void
  setConsoleOpen(open: boolean): void
  setConsoleHeight(height: number): void
  fetchModels(provider: ProviderId, force?: boolean): Promise<void>
  fetchTools(serverId: string, force?: boolean): Promise<void>
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme
}

export const useUiStore = create<UiState>((set, get) => ({
  settings: null,
  selection: null,
  settingsOpen: false,
  consoleOpen: false,
  consoleHeight: 320,
  modelCache: {},
  toolCache: {},

  async loadSettings() {
    const settings = await window.api.getSettings()
    applyTheme(settings.theme)
    set({ settings })
  },

  async updateSettings(patch) {
    const settings = await window.api.updateSettings(patch)
    applyTheme(settings.theme)
    const toolCache = { ...get().toolCache }
    if (patch.mcpServers) {
      for (const id of Object.keys(toolCache)) {
        if (!settings.mcpServers.some((s) => s.id === id)) delete toolCache[id]
      }
    }
    set({ settings, toolCache })
  },

  async setTheme(theme) {
    applyTheme(theme)
    await get().updateSettings({ theme })
  },

  select(selection) {
    set({ selection })
  },

  setSettingsOpen(settingsOpen) {
    set({ settingsOpen })
  },

  setConsoleOpen(consoleOpen) {
    set({ consoleOpen })
  },

  setConsoleHeight(height) {
    set({ consoleHeight: Math.min(Math.max(height, 140), Math.round(window.innerHeight * 0.7)) })
  },

  async fetchModels(provider, force = false) {
    if (!force && get().modelCache[provider]) return
    try {
      const result = await window.api.listModels(provider)
      set({ modelCache: { ...get().modelCache, [provider]: result } })
    } catch (err) {
      set({ modelCache: { ...get().modelCache, [provider]: { models: [], source: 'fallback', error: describeError(err) } } })
    }
  },

  async fetchTools(serverId, force = false) {
    const existing = get().toolCache[serverId]
    if (!force && existing && existing.status !== 'error') return
    set({ toolCache: { ...get().toolCache, [serverId]: { status: 'loading', tools: existing?.tools ?? [] } } })
    const result = await window.api.listMcpTools(serverId)
    const entry: ToolCacheEntry = result.ok
      ? { status: 'ready', tools: result.tools }
      : { status: 'error', tools: existing?.tools ?? [], error: result.error }
    set({ toolCache: { ...get().toolCache, [serverId]: entry } })
  }
}))
```

`src/renderer/store/graph.ts`:
```ts
import { create } from 'zustand'
import type { AgentNode, EdgeKind, Graph, GraphEdge, Position } from '@shared/types'
import { createAgentNode, emptyGraph, newId } from '@shared/graph-defaults'

interface GraphState {
  graph: Graph
  path: string | null
  dirty: boolean
  setGraph(graph: Graph, path: string | null): void
  newGraph(): void
  setName(name: string): void
  addNode(position: Position): AgentNode
  updateNode(id: string, patch: Partial<AgentNode>): void
  moveNode(id: string, position: Position): void
  removeNodes(ids: string[]): void
  duplicateNode(id: string): AgentNode | null
  addEdge(source: string, target: string, kind?: EdgeKind): GraphEdge | null
  updateEdge(id: string, patch: Partial<GraphEdge>): void
  removeEdges(ids: string[]): void
  setEntry(id: string): void
  markSaved(path: string): void
}

export const useGraphStore = create<GraphState>((set, get) => {
  const patchGraph = (fn: (graph: Graph) => Graph): void => {
    set((state) => ({ graph: fn(state.graph), dirty: true }))
  }

  return {
    graph: emptyGraph(),
    path: null,
    dirty: false,

    setGraph(graph, path) {
      set({ graph, path, dirty: false })
    },

    newGraph() {
      set({ graph: emptyGraph(), path: null, dirty: false })
    },

    setName(name) {
      patchGraph((g) => ({ ...g, name }))
    },

    addNode(position) {
      const node = createAgentNode(position)
      patchGraph((g) => ({
        ...g,
        nodes: [...g.nodes, node],
        entryNodeId: g.entryNodeId ?? node.id
      }))
      return node
    },

    updateNode(id, patch) {
      patchGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }))
    },

    moveNode(id, position) {
      patchGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, position } : n)) }))
    },

    removeNodes(ids) {
      const gone = new Set(ids)
      patchGraph((g) => ({
        ...g,
        nodes: g.nodes.filter((n) => !gone.has(n.id)),
        edges: g.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
        entryNodeId: g.entryNodeId && gone.has(g.entryNodeId) ? null : g.entryNodeId
      }))
    },

    duplicateNode(id) {
      const source = get().graph.nodes.find((n) => n.id === id)
      if (!source) return null
      const copy: AgentNode = {
        ...source,
        id: newId(),
        name: `${source.name} copy`,
        position: { x: source.position.x + 40, y: source.position.y + 40 },
        tools: source.tools.map((t) => ({ ...t, names: t.names === '*' ? '*' : [...t.names] }))
      }
      patchGraph((g) => ({ ...g, nodes: [...g.nodes, copy] }))
      return copy
    },

    addEdge(source, target, kind = 'handoff') {
      const g = get().graph
      const ids = new Set(g.nodes.map((n) => n.id))
      if (!ids.has(source) || !ids.has(target)) return null
      if (g.edges.some((e) => e.source === source && e.target === target && e.kind === kind)) return null
      const edge: GraphEdge = { id: newId(), source, target, kind }
      patchGraph((graph) => ({ ...graph, edges: [...graph.edges, edge] }))
      return edge
    },

    updateEdge(id, patch) {
      patchGraph((g) => ({ ...g, edges: g.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
    },

    removeEdges(ids) {
      const gone = new Set(ids)
      patchGraph((g) => ({ ...g, edges: g.edges.filter((e) => !gone.has(e.id)) }))
    },

    setEntry(id) {
      patchGraph((g) => ({ ...g, entryNodeId: id }))
    },

    markSaved(path) {
      set({ path, dirty: false })
    }
  }
})
```

`src/renderer/store/run.ts`:
```ts
import { create } from 'zustand'
import type { EdgeKind } from '@shared/types'
import type { RunEvent } from '@shared/events'

export type NodeStatus = 'running' | 'done' | 'error'

export interface ToolCallView {
  callId: string
  name: string
  args: unknown
  result?: string
  isError?: boolean
}

export interface MarkerView {
  kind: EdgeKind
  edgeId: string
  message: string
}

export interface ExecutionView {
  executionId: string
  nodeId: string
  parentExecutionId: string | null
  depth: number
  input: string
  text: string
  toolCalls: ToolCallView[]
  markers: MarkerView[]
  status: NodeStatus
  error?: string
  output?: string
}

export interface RunState {
  runId: string | null
  status: 'idle' | 'running' | 'finished' | 'error' | 'cancelled'
  executions: ExecutionView[]
  output: string | null
  error: string | null
  warnings: string[]
  traversedEdgeIds: string[]
  nodeStatus: Record<string, NodeStatus>
}

export const initialRunState: RunState = {
  runId: null,
  status: 'idle',
  executions: [],
  output: null,
  error: null,
  warnings: [],
  traversedEdgeIds: [],
  nodeStatus: {}
}

function updateExecution(state: RunState, executionId: string, fn: (e: ExecutionView) => ExecutionView): RunState {
  const index = state.executions.findIndex((e) => e.executionId === executionId)
  if (index === -1) return state
  const executions = state.executions.slice()
  executions[index] = fn(executions[index])
  return { ...state, executions }
}

export function applyRunEvent(state: RunState, event: RunEvent): RunState {
  if (event.type === 'run.started') {
    return { ...initialRunState, runId: event.runId, status: 'running' }
  }
  if (event.runId !== state.runId) return state

  switch (event.type) {
    case 'run.warning':
      return { ...state, warnings: [...state.warnings, event.message] }
    case 'node.started':
      return {
        ...state,
        executions: [
          ...state.executions,
          {
            executionId: event.executionId,
            nodeId: event.nodeId,
            parentExecutionId: event.parentExecutionId,
            depth: event.depth,
            input: event.input,
            text: '',
            toolCalls: [],
            markers: [],
            status: 'running'
          }
        ],
        nodeStatus: { ...state.nodeStatus, [event.nodeId]: 'running' }
      }
    case 'node.text':
      return updateExecution(state, event.executionId, (e) => ({ ...e, text: e.text + event.delta }))
    case 'node.tool.call':
      return updateExecution(state, event.executionId, (e) => ({
        ...e,
        toolCalls: [...e.toolCalls, { callId: event.callId, name: event.name, args: event.args }]
      }))
    case 'node.tool.result':
      return updateExecution(state, event.executionId, (e) => ({
        ...e,
        toolCalls: e.toolCalls.map((c) => (c.callId === event.callId ? { ...c, result: event.content, isError: event.isError } : c))
      }))
    case 'node.finished': {
      const next = updateExecution(state, event.executionId, (e) => ({ ...e, status: 'done', output: event.output }))
      const exec = next.executions.find((e) => e.executionId === event.executionId)
      return exec ? { ...next, nodeStatus: { ...next.nodeStatus, [exec.nodeId]: 'done' } } : next
    }
    case 'node.error': {
      const next = updateExecution(state, event.executionId, (e) => ({ ...e, status: 'error', error: event.error }))
      const exec = next.executions.find((e) => e.executionId === event.executionId)
      return exec ? { ...next, nodeStatus: { ...next.nodeStatus, [exec.nodeId]: 'error' } } : next
    }
    case 'edge.traversed': {
      const next = updateExecution(state, event.fromExecutionId, (e) => ({
        ...e,
        markers: [...e.markers, { kind: event.kind, edgeId: event.edgeId, message: event.message }]
      }))
      return { ...next, traversedEdgeIds: [...next.traversedEdgeIds, event.edgeId] }
    }
    case 'run.finished':
      return { ...state, status: 'finished', output: event.output }
    case 'run.error':
      return { ...state, status: 'error', error: event.error }
    case 'run.cancelled':
      return { ...state, status: 'cancelled' }
    default:
      return state
  }
}

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

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/renderer/store && npm run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/styles src/renderer/lib src/renderer/store
git commit -m "Add renderer theme, styles, and graph/ui/run stores

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Canvas, node card, edge view, context menu, app layout

**Files:**
- Create: `src/renderer/components/AgentNodeCard.tsx`, `src/renderer/components/GraphEdgeView.tsx`, `src/renderer/components/ContextMenu.tsx`, `src/renderer/components/Canvas.tsx`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `useGraphStore`, `useUiStore`, `useRunStore`, `NodeStatus`; `AgentNode`, `GraphEdge`, `PROVIDER_LABELS` from `@shared/types`.
- Produces: `type AgentNodeData = { node: AgentNode; isEntry: boolean; status?: NodeStatus; warning: boolean }`, `type AgentFlowNode = Node<AgentNodeData, 'agent'>`, `AgentNodeCard`, `toolSummary(node): string`; `type GraphEdgeData = { edge: GraphEdge; traversed: boolean }`, `type GraphFlowEdge = Edge<GraphEdgeData, 'graph'>`, `GraphEdgeView`; `interface MenuItem { label: string; onClick: () => void; disabled?: boolean }`, `ContextMenu({ x, y, items, onClose })`; `Canvas()` (wraps its own `ReactFlowProvider`).

Design notes: React Flow keeps its own view state (selection, drag, measurements). The graph store is the model. Two effects rebuild the view nodes/edges from the model whenever it changes, preserving `selected`, `measured`, and in-progress drag positions from the previous view state. View to model flows through `onNodeDragStop`, `onNodesDelete`, `onEdgesDelete`, `onConnect`, and `onSelectionChange`.

- [ ] **Step 1: Write the node card**

`src/renderer/components/AgentNodeCard.tsx`:
```tsx
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { PROVIDER_LABELS, type AgentNode } from '@shared/types'
import type { NodeStatus } from '@/store/run'

export type AgentNodeData = { node: AgentNode; isEntry: boolean; status?: NodeStatus; warning: boolean }
export type AgentFlowNode = Node<AgentNodeData, 'agent'>

export function toolSummary(node: AgentNode): string {
  if (node.tools.length === 0) return 'no tools'
  const all = node.tools.filter((t) => t.names === '*').length
  const named = node.tools.reduce((n, t) => (t.names === '*' ? n : n + t.names.length), 0)
  if (all > 0) {
    const servers = `${all} server${all === 1 ? '' : 's'}`
    return named > 0 ? `all tools · ${servers} + ${named}` : `all tools · ${servers}`
  }
  return `${named} tool${named === 1 ? '' : 's'}`
}

const GLYPH: Record<NodeStatus, string> = { running: '●', done: '✓', error: '!' }

export function AgentNodeCard({ data }: NodeProps<AgentFlowNode>) {
  const { node, isEntry, status, warning } = data
  return (
    <div className={`agent-node${status ? ` status-${status}` : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="agent-node-head">
        <span className="agent-node-name" title={node.name}>
          {node.name.trim() || 'Untitled'}
        </span>
        {isEntry && <span className="badge">ENTRY</span>}
      </div>
      <div className="agent-node-meta" title={node.model}>
        {PROVIDER_LABELS[node.provider]} · {node.model}
      </div>
      <div className="agent-node-foot">
        <span>
          {toolSummary(node)}
          {warning ? ' · missing server' : ''}
        </span>
        <span>{status ? GLYPH[status] : ''}</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
```

- [ ] **Step 2: Write the edge view**

`src/renderer/components/GraphEdgeView.tsx`:
```tsx
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'
import type { GraphEdge } from '@shared/types'

export type GraphEdgeData = { edge: GraphEdge; traversed: boolean }
export type GraphFlowEdge = Edge<GraphEdgeData, 'graph'>

export function GraphEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd
}: EdgeProps<GraphFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const kind = data?.edge.kind ?? 'handoff'
  const description = data?.edge.description?.trim()
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={data?.traversed ? 'traversed' : undefined}
        style={{ strokeDasharray: kind === 'delegate' ? '6 4' : undefined }}
      />
      {description && (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={description}
          >
            {description}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
```

- [ ] **Step 3: Write the context menu**

`src/renderer/components/ContextMenu.tsx`:
```tsx
import { useEffect } from 'react'

export interface MenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  useEffect(() => {
    const close = (): void => onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])

  const left = Math.min(x, window.innerWidth - 180)
  const top = Math.min(y, window.innerHeight - items.length * 32 - 12)

  return (
    <div className="context-menu" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          disabled={item.disabled}
          onClick={() => {
            item.onClick()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Write the canvas**

`src/renderer/components/Canvas.tsx`:
```tsx
import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { AgentNode, GraphEdge } from '@shared/types'
import { useGraphStore } from '@/store/graph'
import { useUiStore, type Selection } from '@/store/ui'
import { useRunStore, type NodeStatus } from '@/store/run'
import { AgentNodeCard, type AgentFlowNode } from './AgentNodeCard'
import { GraphEdgeView, type GraphFlowEdge } from './GraphEdgeView'
import { ContextMenu, type MenuItem } from './ContextMenu'

const nodeTypes: NodeTypes = { agent: AgentNodeCard }
const edgeTypes: EdgeTypes = { graph: GraphEdgeView }

const NODE_WIDTH = 220
const NODE_HEIGHT = 74

function toFlowNode(
  node: AgentNode,
  isEntry: boolean,
  status: NodeStatus | undefined,
  warning: boolean,
  selection: Selection,
  prev: AgentFlowNode | undefined
): AgentFlowNode {
  return {
    id: node.id,
    type: 'agent',
    position: prev?.dragging ? prev.position : node.position,
    data: { node, isEntry, status, warning },
    selected: prev ? prev.selected : selection?.type === 'node' && selection.id === node.id,
    dragging: prev?.dragging,
    measured: prev?.measured
  }
}

function toFlowEdge(edge: GraphEdge, traversed: boolean, markerColor: string, prev: GraphFlowEdge | undefined): GraphFlowEdge {
  return {
    id: edge.id,
    type: 'graph',
    source: edge.source,
    target: edge.target,
    data: { edge, traversed },
    selected: prev?.selected ?? false,
    markerEnd: { type: MarkerType.ArrowClosed, color: markerColor, width: 16, height: 16 }
  }
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

function CanvasInner() {
  const graph = useGraphStore((s) => s.graph)
  const settings = useUiStore((s) => s.settings)
  const selection = useUiStore((s) => s.selection)
  const select = useUiStore((s) => s.select)
  const nodeStatus = useRunStore((s) => s.nodeStatus)
  const traversed = useRunStore((s) => s.traversedEdgeIds)
  const { screenToFlowPosition } = useReactFlow()

  const theme = settings?.theme ?? 'dark'
  const markerColor = theme === 'dark' ? '#6f6f6f' : '#8f8f8f'
  const knownServers = useMemo(() => new Set((settings?.mcpServers ?? []).map((s) => s.id)), [settings])

  const [nodes, setNodes, onNodesChange] = useNodesState<AgentFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<GraphFlowEdge>([])
  const [menu, setMenu] = useState<MenuState | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((p) => [p.id, p]))
      return graph.nodes.map((n) =>
        toFlowNode(
          n,
          graph.entryNodeId === n.id,
          nodeStatus[n.id],
          n.tools.some((t) => !knownServers.has(t.serverId)),
          selection,
          prevById.get(n.id)
        )
      )
    })
  }, [graph.nodes, graph.entryNodeId, nodeStatus, knownServers, selection, setNodes])

  useEffect(() => {
    setEdges((prev) => {
      const prevById = new Map(prev.map((p) => [p.id, p]))
      const traversedSet = new Set(traversed)
      return graph.edges.map((e) => toFlowEdge(e, traversedSet.has(e.id), markerColor, prevById.get(e.id)))
    })
  }, [graph.edges, traversed, markerColor, setEdges])

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source && connection.target) useGraphStore.getState().addEdge(connection.source, connection.target)
  }, [])

  const onNodeDragStop = useCallback((_event: ReactMouseEvent, _node: AgentFlowNode, dragged: AgentFlowNode[]) => {
    const { moveNode } = useGraphStore.getState()
    for (const n of dragged) moveNode(n.id, n.position)
  }, [])

  const onNodesDelete = useCallback((deleted: AgentFlowNode[]) => {
    useGraphStore.getState().removeNodes(deleted.map((n) => n.id))
  }, [])

  const onEdgesDelete = useCallback((deleted: GraphFlowEdge[]) => {
    useGraphStore.getState().removeEdges(deleted.map((e) => e.id))
  }, [])

  const onSelectionChange = useCallback(
    ({ nodes: n, edges: e }: { nodes: Node[]; edges: Edge[] }) => {
      if (n.length === 1 && e.length === 0) select({ type: 'node', id: n[0].id })
      else if (e.length === 1 && n.length === 0) select({ type: 'edge', id: e[0].id })
      else select(null)
    },
    [select]
  )

  const addNodeAt = useCallback(
    (clientX: number, clientY: number) => {
      const position = screenToFlowPosition({ x: clientX, y: clientY })
      const node = useGraphStore.getState().addNode({ x: position.x - NODE_WIDTH / 2, y: position.y - NODE_HEIGHT / 2 })
      select({ type: 'node', id: node.id })
    },
    [screenToFlowPosition, select]
  )

  const onDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (!(event.target as HTMLElement).classList.contains('react-flow__pane')) return
      addNodeAt(event.clientX, event.clientY)
    },
    [addNodeAt]
  )

  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault()
      const { clientX, clientY } = event
      setMenu({ x: clientX, y: clientY, items: [{ label: 'Add agent here', onClick: () => addNodeAt(clientX, clientY) }] })
    },
    [addNodeAt]
  )

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: AgentFlowNode) => {
      event.preventDefault()
      const store = useGraphStore.getState()
      setMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          { label: 'Set as entry', disabled: store.graph.entryNodeId === node.id, onClick: () => store.setEntry(node.id) },
          {
            label: 'Duplicate',
            onClick: () => {
              const copy = store.duplicateNode(node.id)
              if (copy) select({ type: 'node', id: copy.id })
            }
          },
          {
            label: 'Delete',
            onClick: () => {
              store.removeNodes([node.id])
              select(null)
            }
          }
        ]
      })
    },
    [select]
  )

  const onEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: GraphFlowEdge) => {
      event.preventDefault()
      const store = useGraphStore.getState()
      const current = store.graph.edges.find((e) => e.id === edge.id)
      if (!current) return
      const flipped = current.kind === 'handoff' ? 'delegate' : 'handoff'
      setMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          { label: `Change to ${flipped}`, onClick: () => store.updateEdge(edge.id, { kind: flipped }) },
          {
            label: 'Delete',
            onClick: () => {
              store.removeEdges([edge.id])
              select(null)
            }
          }
        ]
      })
    },
    [select]
  )

  return (
    <div className="canvas" onDoubleClick={onDoubleClick}>
      <ReactFlow<AgentFlowNode, GraphFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onSelectionChange={onSelectionChange}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        fitView
        zoomOnDoubleClick={false}
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.2}
        maxZoom={2}
        colorMode={theme}
        defaultEdgeOptions={{ type: 'graph' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color={theme === 'dark' ? '#2a2a2a' : '#d9d9d9'} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      {graph.nodes.length === 0 && <div className="canvas-hint">Double-click to add an agent</div>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </div>
  )
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
```

- [ ] **Step 5: Update the app shell**

`src/renderer/App.tsx`:
```tsx
import { useEffect } from 'react'
import '@/styles/theme.css'
import '@/styles/app.css'
import { useUiStore } from '@/store/ui'
import { Canvas } from '@/components/Canvas'

export default function App() {
  const loadSettings = useUiStore((s) => s.loadSettings)
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  return (
    <div className="app">
      <header className="topbar" />
      <Canvas />
    </div>
  )
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run build && npm test`
Expected: clean typecheck, successful build, all tests pass.

Run `npm run dev` and check by hand: double-click adds a node with an ENTRY badge on the first one; dragging moves; dragging from the right handle to another node's left handle creates a solid edge with an arrow; right-clicking the edge offers "Change to delegate" (edge becomes dashed) and Delete; Backspace deletes a selected node together with its edges; right-clicking the pane offers "Add agent here". Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/AgentNodeCard.tsx src/renderer/components/GraphEdgeView.tsx src/renderer/components/ContextMenu.tsx src/renderer/components/Canvas.tsx src/renderer/App.tsx
git commit -m "Add React Flow canvas with agent nodes, edges, and context menus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Inspector panel

**Files:**
- Create: `src/renderer/components/Inspector.tsx`, `src/renderer/components/NodeInspector.tsx`, `src/renderer/components/EdgeInspector.tsx`, `src/renderer/components/ModelCombo.tsx`, `src/renderer/components/ToolPicker.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/styles/app.css` (append)

**Interfaces:**
- Consumes: `useGraphStore`, `useUiStore`; `AgentNode`, `GraphEdge`, `ToolGrant`, `ProviderId`, `PROVIDER_IDS`, `PROVIDER_LABELS`, `DEFAULT_MODELS`.
- Produces: `Inspector()`, `NodeInspector({ node })`, `EdgeInspector({ edge })`, `ModelCombo({ provider, value, onChange })`, `ToolPicker({ node })`.

- [ ] **Step 1: Append styles**

Append to `src/renderer/styles/app.css`:
```css

/* Inspector additions */
.tool-desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.number-field {
  flex: 1;
  min-width: 0;
}
.number-field input {
  width: 100%;
}
```

- [ ] **Step 2: Write the model combo**

`src/renderer/components/ModelCombo.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { ProviderId } from '@shared/types'
import { useUiStore } from '@/store/ui'

interface Props {
  provider: ProviderId
  value: string
  onChange: (model: string) => void
}

export function ModelCombo({ provider, value, onChange }: Props) {
  const cache = useUiStore((s) => s.modelCache[provider])
  const fetchModels = useUiStore((s) => s.fetchModels)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void fetchModels(provider)
  }, [provider, fetchModels])

  const models = cache?.models ?? []
  const filtered = models.filter((m) => m.toLowerCase().includes(value.trim().toLowerCase()))
  const list = filtered.length > 0 ? filtered : models

  let status = 'Loading models…'
  if (cache?.source === 'api') status = `${models.length} models from the API`
  else if (cache) status = `Built-in list${cache.error ? ` · ${cache.error}` : ''}`

  return (
    <div className="combo">
      <input
        className="input mono"
        value={value}
        spellCheck={false}
        placeholder="model id"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && list.length > 0 && (
        <div className="combo-list">
          {list.map((m) => (
            <button
              key={m}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(m)
                setOpen(false)
              }}
            >
              {m}
            </button>
          ))}
        </div>
      )}
      <div className="row small faint" style={{ marginTop: 4, justifyContent: 'space-between' }}>
        <span title={cache?.error}>{status}</span>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => void fetchModels(provider, true)}>
          Refresh
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write the tool picker**

`src/renderer/components/ToolPicker.tsx`:
```tsx
import { useState } from 'react'
import type { AgentNode, ToolGrant } from '@shared/types'
import { useGraphStore } from '@/store/graph'
import { useUiStore } from '@/store/ui'

interface Props {
  node: AgentNode
}

export function ToolPicker({ node }: Props) {
  const servers = useUiStore((s) => s.settings?.mcpServers ?? [])
  const toolCache = useUiStore((s) => s.toolCache)
  const fetchTools = useUiStore((s) => s.fetchTools)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const updateTools = (tools: ToolGrant[]): void => useGraphStore.getState().updateNode(node.id, { tools })
  const setGrant = (serverId: string, grant: ToolGrant | null): void => {
    const rest = node.tools.filter((t) => t.serverId !== serverId)
    updateTools(grant ? [...rest, grant] : rest)
  }

  const missing = node.tools.filter((t) => !servers.some((s) => s.id === t.serverId))

  if (servers.length === 0) {
    return (
      <div className="small muted">
        No MCP servers configured.{' '}
        <button type="button" className="btn btn-small" onClick={() => setSettingsOpen(true)}>
          Add one in Settings
        </button>
      </div>
    )
  }

  return (
    <>
      {servers.map((server) => {
        const grant = node.tools.find((t) => t.serverId === server.id)
        const all = grant?.names === '*'
        const names = grant && grant.names !== '*' ? grant.names : []
        const cache = toolCache[server.id]
        const isOpen = expanded[server.id] ?? false
        const toggle = (): void => {
          setExpanded({ ...expanded, [server.id]: !isOpen })
          if (!isOpen) void fetchTools(server.id)
        }
        return (
          <div className="server-block" key={server.id}>
            <div className="server-head">
              <button type="button" className="btn btn-ghost btn-icon btn-small" onClick={toggle} title="Show tools">
                {isOpen ? '▾' : '▸'}
              </button>
              <span className="grow" title={server.name}>
                {server.name}
              </span>
              <span className="small faint">{all ? 'all' : names.length > 0 ? String(names.length) : 'none'}</span>
              <label className="row small">
                <input
                  type="checkbox"
                  checked={all}
                  onChange={(e) =>
                    setGrant(
                      server.id,
                      e.target.checked ? { serverId: server.id, names: '*' } : names.length > 0 ? { serverId: server.id, names } : null
                    )
                  }
                />
                all
              </label>
            </div>
            {isOpen && (
              <div className="server-tools">
                {!cache || cache.status === 'loading' ? (
                  <div className="small muted">Connecting…</div>
                ) : cache.status === 'error' ? (
                  <div>
                    <div className="error-text">{cache.error}</div>
                    <button type="button" className="btn btn-small" style={{ marginTop: 6 }} onClick={() => void fetchTools(server.id, true)}>
                      Retry
                    </button>
                  </div>
                ) : cache.tools.length === 0 ? (
                  <div className="small muted">This server exposes no tools.</div>
                ) : (
                  cache.tools.map((tool) => (
                    <label className="tool-check" key={tool.name} title={tool.description}>
                      <input
                        type="checkbox"
                        checked={all || names.includes(tool.name)}
                        disabled={all}
                        onChange={(e) => {
                          const next = e.target.checked ? [...names, tool.name] : names.filter((n) => n !== tool.name)
                          setGrant(server.id, next.length > 0 ? { serverId: server.id, names: next } : null)
                        }}
                      />
                      <span>
                        <span className="mono small">{tool.name}</span>
                        {tool.description && <div className="small faint tool-desc">{tool.description}</div>}
                      </span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}
      {missing.length > 0 && (
        <div className="error-text" style={{ marginTop: 8 }}>
          This agent references {missing.length} MCP server{missing.length === 1 ? '' : 's'} that no longer exist
          {missing.length === 1 ? 's' : ''}.{' '}
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => updateTools(node.tools.filter((t) => servers.some((s) => s.id === t.serverId)))}
          >
            Remove
          </button>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 4: Write the node and edge inspectors**

`src/renderer/components/NodeInspector.tsx`:
```tsx
import { DEFAULT_MODELS, PROVIDER_IDS, PROVIDER_LABELS, type AgentNode, type ProviderId } from '@shared/types'
import { useGraphStore } from '@/store/graph'
import { ModelCombo } from './ModelCombo'
import { ToolPicker } from './ToolPicker'

interface NumberFieldProps {
  label: string
  value: number | undefined
  min?: number
  max?: number
  step?: number
  onChange: (value: number | undefined) => void
}

function NumberField({ label, value, min, max, step, onChange }: NumberFieldProps) {
  return (
    <div className="field number-field">
      <label className="label">{label}</label>
      <input
        className="input"
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder="default"
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </div>
  )
}

interface Props {
  node: AgentNode
}

export function NodeInspector({ node }: Props) {
  const isEntry = useGraphStore((s) => s.graph.entryNodeId === node.id)
  const update = (patch: Partial<AgentNode>): void => useGraphStore.getState().updateNode(node.id, patch)

  return (
    <>
      <div className="inspector-section">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="inspector-title" style={{ marginBottom: 0 }}>
            Agent
          </div>
          {isEntry ? (
            <span className="badge">ENTRY</span>
          ) : (
            <button type="button" className="btn btn-small" onClick={() => useGraphStore.getState().setEntry(node.id)}>
              Set as entry
            </button>
          )}
        </div>
        <div className="field">
          <label className="label">Name</label>
          <input className="input" value={node.name} onChange={(e) => update({ name: e.target.value })} />
        </div>
        <div className="field">
          <label className="label">Provider</label>
          <select
            className="select"
            value={node.provider}
            onChange={(e) => {
              const provider = e.target.value as ProviderId
              update({ provider, model: DEFAULT_MODELS[provider] })
            }}
          >
            {PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_LABELS[id]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label">Model</label>
          <ModelCombo provider={node.provider} value={node.model} onChange={(model) => update({ model })} />
        </div>
      </div>

      <div className="inspector-section">
        <div className="inspector-title">Instructions</div>
        <textarea
          className="textarea"
          value={node.instructions}
          spellCheck={false}
          placeholder="System prompt for this agent. Describe its role, what it should do, and when to hand off or delegate."
          onChange={(e) => update({ instructions: e.target.value })}
        />
      </div>

      <div className="inspector-section">
        <div className="inspector-title">Tools</div>
        <ToolPicker node={node} />
      </div>

      <div className="inspector-section">
        <div className="inspector-title">Sampling and limits</div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <NumberField label="Temperature" value={node.temperature} min={0} max={2} step={0.1} onChange={(v) => update({ temperature: v })} />
          <NumberField label="Max tokens" value={node.maxTokens} min={1} step={1} onChange={(v) => update({ maxTokens: v })} />
          <NumberField label="Max turns" value={node.maxTurns} min={1} step={1} onChange={(v) => update({ maxTurns: v })} />
        </div>
        <div className="small faint">Blank uses the provider default. The newest Claude models reject temperature.</div>
      </div>
    </>
  )
}
```

`src/renderer/components/EdgeInspector.tsx`:
```tsx
import type { GraphEdge } from '@shared/types'
import { useGraphStore } from '@/store/graph'

interface Props {
  edge: GraphEdge
}

export function EdgeInspector({ edge }: Props) {
  const nodes = useGraphStore((s) => s.graph.nodes)
  const update = (patch: Partial<GraphEdge>): void => useGraphStore.getState().updateEdge(edge.id, patch)
  const source = nodes.find((n) => n.id === edge.source)?.name ?? '?'
  const target = nodes.find((n) => n.id === edge.target)?.name ?? '?'

  return (
    <div className="inspector-section">
      <div className="inspector-title">Edge</div>
      <div className="small muted" style={{ marginBottom: 12 }}>
        {source} → {target}
      </div>
      <div className="field">
        <span className="label">Kind</span>
        <div>
          <div className="segmented">
            <button type="button" className={edge.kind === 'handoff' ? 'active' : ''} onClick={() => update({ kind: 'handoff' })}>
              Handoff
            </button>
            <button type="button" className={edge.kind === 'delegate' ? 'active' : ''} onClick={() => update({ kind: 'delegate' })}>
              Delegate
            </button>
          </div>
        </div>
        <div className="small faint">
          {edge.kind === 'handoff'
            ? `${source} finishes, then ${target} runs with the message it passes along.`
            : `${source} can call ${target} as a tool mid-conversation and gets its result back.`}
        </div>
      </div>
      <div className="field">
        <label className="label">Description</label>
        <textarea
          className="textarea"
          style={{ minHeight: 70 }}
          value={edge.description ?? ''}
          spellCheck={false}
          placeholder={edge.kind === 'handoff' ? 'When should the model choose this route?' : 'What is this agent good for?'}
          onChange={(e) => update({ description: e.target.value })}
        />
        <div className="small faint">Shown to the model as the tool description.</div>
      </div>
    </div>
  )
}
```

`src/renderer/components/Inspector.tsx`:
```tsx
import { useGraphStore } from '@/store/graph'
import { useUiStore } from '@/store/ui'
import { NodeInspector } from './NodeInspector'
import { EdgeInspector } from './EdgeInspector'

export function Inspector() {
  const selection = useUiStore((s) => s.selection)
  const graph = useGraphStore((s) => s.graph)
  if (!selection) return null

  if (selection.type === 'node') {
    const node = graph.nodes.find((n) => n.id === selection.id)
    if (!node) return null
    return (
      <aside className="inspector">
        <NodeInspector node={node} />
      </aside>
    )
  }

  const edge = graph.edges.find((e) => e.id === selection.id)
  if (!edge) return null
  return (
    <aside className="inspector">
      <EdgeInspector edge={edge} />
    </aside>
  )
}
```

- [ ] **Step 5: Add the inspector to the app**

`src/renderer/App.tsx`:
```tsx
import { useEffect } from 'react'
import '@/styles/theme.css'
import '@/styles/app.css'
import { useUiStore } from '@/store/ui'
import { Canvas } from '@/components/Canvas'
import { Inspector } from '@/components/Inspector'

export default function App() {
  const loadSettings = useUiStore((s) => s.loadSettings)
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  return (
    <div className="app">
      <header className="topbar" />
      <Canvas />
      <Inspector />
    </div>
  )
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run build && npm test`
Expected: clean.

Run `npm run dev` and check: selecting a node opens the right panel; renaming updates the card live; switching provider resets the model to that provider's default; the model field shows a dropdown of models (built-in list until keys exist) and accepts free text; the instructions textarea edits; selecting an edge shows the segmented Handoff/Delegate control and description; the canvas updates dash style when the kind changes. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/Inspector.tsx src/renderer/components/NodeInspector.tsx src/renderer/components/EdgeInspector.tsx src/renderer/components/ModelCombo.tsx src/renderer/components/ToolPicker.tsx src/renderer/App.tsx src/renderer/styles/app.css
git commit -m "Add inspector panel with model combo and MCP tool picker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Top bar, file actions, keyboard shortcuts

**Files:**
- Create: `src/renderer/components/TopBar.tsx`, `src/renderer/lib/file-actions.ts`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `useGraphStore`, `useUiStore`, `useRunStore`, `describeError`.
- Produces: `saveGraph(saveAs?: boolean): Promise<boolean>`, `openGraph(): Promise<void>`, `newGraph(): void` (in `file-actions.ts`); `TopBar()`; a `window` custom event named `agent-graph:run` that the top bar dispatches when the console is already open (Task 16 listens for it).

- [ ] **Step 1: Write the file actions**

`src/renderer/lib/file-actions.ts`:
```ts
import { useGraphStore } from '@/store/graph'
import { useUiStore } from '@/store/ui'
import { useRunStore } from '@/store/run'
import { describeError } from './errors'

export const RUN_EVENT = 'agent-graph:run'

export async function saveGraph(saveAs = false): Promise<boolean> {
  const { graph, path, markSaved } = useGraphStore.getState()
  try {
    const saved = await window.api.saveGraph(graph, saveAs ? null : path)
    if (!saved) return false
    markSaved(saved)
    return true
  } catch (err) {
    window.alert(`Could not save the graph. ${describeError(err)}`)
    return false
  }
}

function confirmDiscard(): boolean {
  return !useGraphStore.getState().dirty || window.confirm('Discard unsaved changes?')
}

export async function openGraph(): Promise<void> {
  if (!confirmDiscard()) return
  try {
    const opened = await window.api.openGraph()
    if (!opened) return
    useGraphStore.getState().setGraph(opened.graph, opened.path)
    useUiStore.getState().select(null)
    useRunStore.getState().reset()
  } catch (err) {
    window.alert(`Could not open the file. ${describeError(err)}`)
  }
}

export function newGraph(): void {
  if (!confirmDiscard()) return
  useGraphStore.getState().newGraph()
  useUiStore.getState().select(null)
  useRunStore.getState().reset()
}
```

- [ ] **Step 2: Write the top bar**

`src/renderer/components/TopBar.tsx`:
```tsx
import { useEffect } from 'react'
import { useGraphStore } from '@/store/graph'
import { useUiStore } from '@/store/ui'
import { useRunStore } from '@/store/run'
import { newGraph, openGraph, saveGraph, RUN_EVENT } from '@/lib/file-actions'

export function TopBar() {
  const name = useGraphStore((s) => s.graph.name)
  const dirty = useGraphStore((s) => s.dirty)
  const path = useGraphStore((s) => s.path)
  const setName = useGraphStore((s) => s.setName)
  const theme = useUiStore((s) => s.settings?.theme ?? 'dark')
  const setTheme = useUiStore((s) => s.setTheme)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const consoleOpen = useUiStore((s) => s.consoleOpen)
  const setConsoleOpen = useUiStore((s) => s.setConsoleOpen)
  const runStatus = useRunStore((s) => s.status)

  const triggerRun = (): void => {
    if (!consoleOpen) setConsoleOpen(true)
    else window.dispatchEvent(new Event(RUN_EVENT))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        void saveGraph(e.shiftKey)
      } else if (key === 'o') {
        e.preventDefault()
        void openGraph()
      } else if (key === 'n') {
        e.preventDefault()
        newGraph()
      } else if (key === 'j') {
        e.preventDefault()
        setConsoleOpen(!useUiStore.getState().consoleOpen)
      } else if (key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setConsoleOpen, setSettingsOpen])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (!useGraphStore.getState().dirty) return
      if (!window.confirm('You have unsaved changes. Close anyway?')) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  useEffect(() => {
    document.title = `${name}${dirty ? ' •' : ''} — Agent Graph`
  }, [name, dirty])

  return (
    <header className="topbar">
      <input
        className="topbar-name"
        value={name}
        spellCheck={false}
        title={path ?? 'Not saved yet'}
        onChange={(e) => setName(e.target.value)}
      />
      {dirty && <span className="dirty-dot" title="Unsaved changes" />}
      <span className="spacer" />
      <button type="button" className="btn btn-ghost" onClick={newGraph} title="New graph (⌘N)">
        New
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => void openGraph()} title="Open (⌘O)">
        Open
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => void saveGraph()} title="Save (⌘S, ⇧⌘S to save as)">
        Save
      </button>
      <button type="button" className="btn btn-primary" onClick={triggerRun} title="Run (⌘J toggles the console)">
        {runStatus === 'running' ? 'Running…' : 'Run'}
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        onClick={() => void setTheme(theme === 'dark' ? 'light' : 'dark')}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? '☼' : '☾'}
      </button>
      <button type="button" className="btn btn-ghost btn-icon" onClick={() => setSettingsOpen(true)} title="Settings (⌘,)">
        ⚙
      </button>
    </header>
  )
}
```

- [ ] **Step 3: Use it in the app**

`src/renderer/App.tsx`:
```tsx
import { useEffect } from 'react'
import '@/styles/theme.css'
import '@/styles/app.css'
import { useUiStore } from '@/store/ui'
import { TopBar } from '@/components/TopBar'
import { Canvas } from '@/components/Canvas'
import { Inspector } from '@/components/Inspector'

export default function App() {
  const loadSettings = useUiStore((s) => s.loadSettings)
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  return (
    <div className="app">
      <TopBar />
      <Canvas />
      <Inspector />
    </div>
  )
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build && npm test`
Expected: clean.

Run `npm run dev` and check: the graph name is editable in the top bar; adding a node shows the unsaved dot; Save opens a native save dialog defaulting to `<name>.agentgraph.json`; after saving, the dot disappears and ⌘S saves silently; Open loads the file back with nodes and edges in place; New with unsaved changes asks for confirmation; the theme button flips light and dark and the choice survives an app restart. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TopBar.tsx src/renderer/lib/file-actions.ts src/renderer/App.tsx
git commit -m "Add top bar with file actions, theme toggle, and shortcuts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Run console

**Files:**
- Create: `src/renderer/components/RunConsole.tsx`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `useRunStore` (`handleEvent`, state), `useUiStore` (`consoleOpen`, `consoleHeight`, `setConsoleHeight`, `setConsoleOpen`), `useGraphStore`, `describeError`, `RUN_EVENT`, `ExecutionView`.
- Produces: `RunConsole()`.

- [ ] **Step 1: Write the console**

`src/renderer/components/RunConsole.tsx`:
```tsx
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { useGraphStore } from '@/store/graph'
import { useUiStore } from '@/store/ui'
import { useRunStore, type ExecutionView } from '@/store/run'
import { describeError } from '@/lib/errors'
import { RUN_EVENT } from '@/lib/file-actions'

const STATUS_LABEL = { idle: 'Ready', running: 'Running', finished: 'Finished', error: 'Failed', cancelled: 'Stopped' } as const
const GLYPH = { running: '●', done: '✓', error: '!' } as const

function argsPreview(args: unknown): string {
  try {
    const text = JSON.stringify(args) ?? ''
    return text.length > 80 ? `${text.slice(0, 77)}…` : text
  } catch {
    return ''
  }
}

interface BlockProps {
  exec: ExecutionView
  nodeName: string
  edgeTarget: (edgeId: string) => string
}

function ExecutionBlock({ exec, nodeName, edgeTarget }: BlockProps) {
  return (
    <div className="exec" style={{ '--depth': exec.depth } as CSSProperties}>
      <div className="exec-head">
        <span>{nodeName}</span>
        <span>{GLYPH[exec.status]}</span>
      </div>
      <div className="exec-input">› {exec.input}</div>
      {exec.text && <div className="exec-text">{exec.text}</div>}
      {exec.toolCalls.map((call) => (
        <details className={`tool-row${call.isError ? ' error' : ''}`} key={call.callId}>
          <summary>
            {call.result === undefined ? '… ' : ''}
            {call.name}({argsPreview(call.args)})
          </summary>
          <pre>{JSON.stringify(call.args, null, 2)}</pre>
          {call.result !== undefined && <pre>{call.result || '(empty result)'}</pre>}
        </details>
      ))}
      {exec.markers.map((m, i) => (
        <div className="marker" key={i}>
          {m.kind === 'handoff' ? '→ handoff to' : '↳ delegated to'} {edgeTarget(m.edgeId)}
        </div>
      ))}
      {exec.error && <div className="exec-error">{exec.error}</div>}
    </div>
  )
}

export function RunConsole() {
  const open = useUiStore((s) => s.consoleOpen)
  const height = useUiStore((s) => s.consoleHeight)
  const setHeight = useUiStore((s) => s.setConsoleHeight)
  const setOpen = useUiStore((s) => s.setConsoleOpen)
  const run = useRunStore()
  const graph = useGraphStore((s) => s.graph)
  const [input, setInput] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => window.api.onRunEvent(run.handleEvent), [run.handleEvent])

  const start = useCallback(async () => {
    const text = input.trim()
    if (!text || useRunStore.getState().status === 'running') return
    setStartError(null)
    try {
      setRunId(await window.api.startRun(useGraphStore.getState().graph, text))
    } catch (err) {
      setStartError(describeError(err))
    }
  }, [input])

  const stop = useCallback(() => {
    if (runId) void window.api.stopRun(runId)
  }, [runId])

  useEffect(() => {
    const handler = (): void => {
      void start()
    }
    window.addEventListener(RUN_EVENT, handler)
    return () => window.removeEventListener(RUN_EVENT, handler)
  }, [start])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [run.executions, run.output, run.error, run.status])

  const onResizeStart = (e: ReactMouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height
    const move = (ev: MouseEvent): void => setHeight(startHeight + (startY - ev.clientY))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (!open) return null

  const nodeName = (id: string): string => graph.nodes.find((n) => n.id === id)?.name ?? 'Unknown agent'
  const edgeTarget = (edgeId: string): string => {
    const edge = graph.edges.find((e) => e.id === edgeId)
    return edge ? nodeName(edge.target) : '?'
  }
  const running = run.status === 'running'

  return (
    <section className="console" style={{ height }}>
      <div className="console-resize" onMouseDown={onResizeStart} />
      <div className="console-header">
        <span>Run</span>
        <span className="muted">· {STATUS_LABEL[run.status]}</span>
        <span className="spacer" />
        {running && (
          <button type="button" className="btn btn-small" onClick={stop}>
            Stop
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-icon btn-small" onClick={() => setOpen(false)} title="Hide console (⌘J)">
          ×
        </button>
      </div>
      <div className="console-body" ref={bodyRef}>
        {run.warnings.map((w, i) => (
          <div key={i} className="warning-line">
            ⚠ {w}
          </div>
        ))}
        {run.executions.length === 0 && run.status === 'idle' && !startError && (
          <div className="faint">Type a message below and press ⌘↩ to run the graph from its entry node.</div>
        )}
        {run.executions.map((exec) => (
          <ExecutionBlock key={exec.executionId} exec={exec} nodeName={nodeName(exec.nodeId)} edgeTarget={edgeTarget} />
        ))}
        {run.status === 'finished' && (
          <div className="run-output">
            <div className="exec-head">Result</div>
            {run.output || <span className="faint">(empty)</span>}
          </div>
        )}
        {run.status === 'error' && <div className="run-output exec-error">{run.error}</div>}
        {run.status === 'cancelled' && <div className="run-output muted">Run stopped.</div>}
        {startError && <div className="run-output exec-error">{startError}</div>}
      </div>
      <div className="console-input">
        <textarea
          ref={inputRef}
          className="textarea"
          value={input}
          placeholder="Message for the entry agent…"
          spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void start()
            }
          }}
        />
        {running ? (
          <button type="button" className="btn" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={!input.trim()}>
            Run
          </button>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add it to the app**

`src/renderer/App.tsx`:
```tsx
import { useEffect } from 'react'
import '@/styles/theme.css'
import '@/styles/app.css'
import { useUiStore } from '@/store/ui'
import { TopBar } from '@/components/TopBar'
import { Canvas } from '@/components/Canvas'
import { Inspector } from '@/components/Inspector'
import { RunConsole } from '@/components/RunConsole'

export default function App() {
  const loadSettings = useUiStore((s) => s.loadSettings)
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  return (
    <div className="app">
      <TopBar />
      <Canvas />
      <Inspector />
      <RunConsole />
    </div>
  )
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build && npm test`
Expected: clean.

Run `npm run dev` and check: Run in the top bar opens the console with the input focused; running with no entry node or no API key shows the error inline; the console resizes by dragging its top edge; × hides it and ⌘J brings it back. A real end-to-end run needs an API key, which Task 17 adds. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/RunConsole.tsx src/renderer/App.tsx
git commit -m "Add run console with streaming timeline

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Settings dialog

**Files:**
- Create: `src/renderer/lib/kv.ts`, `src/renderer/components/SettingsDialog.tsx`
- Modify: `src/renderer/App.tsx`
- Test: `src/renderer/lib/kv.test.ts`

**Interfaces:**
- Consumes: `useUiStore`, `describeError`, `newId`, `PROVIDER_IDS`, `PROVIDER_LABELS`, `McpServerConfig`, `RunLimits`, `McpToolSummary`.
- Produces: `parseLines(text): string[]`, `parsePairs(text, sep): Record<string, string>`, `formatPairs(map, sep): string`; `SettingsDialog()`.

- [ ] **Step 1: Write the failing test**

`src/renderer/lib/kv.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseLines, parsePairs, formatPairs } from './kv'

describe('kv helpers', () => {
  it('splits lines and trims blanks', () => {
    expect(parseLines(' a \n\n b\n')).toEqual(['a', 'b'])
  })

  it('parses key/value pairs on the first separator only', () => {
    expect(parsePairs('A=1\nB = x=y\nbroken\n=nokey', '=')).toEqual({ A: '1', B: 'x=y' })
    expect(parsePairs('Authorization: Bearer a:b', ':')).toEqual({ Authorization: 'Bearer a:b' })
  })

  it('formats pairs back and round-trips', () => {
    const map = { A: '1', B: 'two' }
    expect(formatPairs(map, '=')).toBe('A=1\nB=two')
    expect(parsePairs(formatPairs(map, ': '), ':')).toEqual(map)
    expect(formatPairs(undefined, '=')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/lib/kv.test.ts`
Expected: FAIL, cannot find module `./kv`.

- [ ] **Step 3: Implement the helpers**

`src/renderer/lib/kv.ts`:
```ts
export function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function parsePairs(text: string, sep: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of parseLines(text)) {
    const index = line.indexOf(sep)
    if (index <= 0) continue
    out[line.slice(0, index).trim()] = line.slice(index + sep.length).trim()
  }
  return out
}

export function formatPairs(map: Record<string, string> | undefined, sep: string): string {
  return Object.entries(map ?? {})
    .map(([key, value]) => `${key}${sep}${value}`)
    .join('\n')
}
```

- [ ] **Step 4: Write the dialog**

`src/renderer/components/SettingsDialog.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react'
import { PROVIDER_IDS, PROVIDER_LABELS, type McpServerConfig, type ProviderId, type RunLimits } from '@shared/types'
import type { McpToolSummary } from '@shared/ipc'
import { newId } from '@shared/graph-defaults'
import { useUiStore } from '@/store/ui'
import { describeError } from '@/lib/errors'
import { formatPairs, parseLines, parsePairs } from '@/lib/kv'

type Tab = 'keys' | 'mcp' | 'limits'
const TABS: { id: Tab; label: string }[] = [
  { id: 'keys', label: 'API keys' },
  { id: 'mcp', label: 'MCP servers' },
  { id: 'limits', label: 'Limits' }
]

function KeysTab() {
  const [status, setStatus] = useState<Partial<Record<ProviderId, boolean>>>({})
  const [drafts, setDrafts] = useState<Partial<Record<ProviderId, string>>>({})
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const entries = await Promise.all(PROVIDER_IDS.map(async (id) => [id, await window.api.hasSecret(id)] as const))
    setStatus(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = async (id: ProviderId): Promise<void> => {
    const key = (drafts[id] ?? '').trim()
    if (!key) return
    setError(null)
    try {
      await window.api.setSecret(id, key)
      setDrafts({ ...drafts, [id]: '' })
      void useUiStore.getState().fetchModels(id, true)
      await refresh()
    } catch (err) {
      setError(describeError(err))
    }
  }

  const clear = async (id: ProviderId): Promise<void> => {
    await window.api.clearSecret(id)
    void useUiStore.getState().fetchModels(id, true)
    await refresh()
  }

  return (
    <>
      <div className="small muted" style={{ marginBottom: 14 }}>
        Keys are encrypted with the system keychain and never written into graph files.
      </div>
      {PROVIDER_IDS.map((id) => (
        <div className="field" key={id}>
          <label className="label">
            {PROVIDER_LABELS[id]} {status[id] ? <span className="faint">· configured</span> : null}
          </label>
          <div className="row">
            <input
              className="input mono"
              type="password"
              placeholder={status[id] ? 'Paste a new key to replace' : 'Paste API key'}
              value={drafts[id] ?? ''}
              onChange={(e) => setDrafts({ ...drafts, [id]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save(id)
              }}
            />
            <button type="button" className="btn" disabled={!(drafts[id] ?? '').trim()} onClick={() => void save(id)}>
              Save
            </button>
            {status[id] && (
              <button type="button" className="btn btn-ghost" onClick={() => void clear(id)}>
                Clear
              </button>
            )}
          </div>
        </div>
      ))}
      {error && <div className="error-text">{error}</div>}
    </>
  )
}

interface FormProps {
  initial: McpServerConfig
  onSave: (config: McpServerConfig) => Promise<void>
  onCancel: () => void
}

function ServerForm({ initial, onSave, onCancel }: FormProps) {
  const [name, setName] = useState(initial.name)
  const [transport, setTransport] = useState<'stdio' | 'http'>(initial.transport)
  const [command, setCommand] = useState(initial.transport === 'stdio' ? initial.command : '')
  const [args, setArgs] = useState(initial.transport === 'stdio' ? initial.args.join('\n') : '')
  const [env, setEnv] = useState(initial.transport === 'stdio' ? formatPairs(initial.env, '=') : '')
  const [url, setUrl] = useState(initial.transport === 'http' ? initial.url : '')
  const [headers, setHeaders] = useState(initial.transport === 'http' ? formatPairs(initial.headers, ': ') : '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ tools: McpToolSummary[] } | { error: string } | null>(null)

  const build = (): McpServerConfig => {
    const base = { id: initial.id, name: name.trim() || 'MCP server' }
    if (transport === 'stdio') {
      const envMap = parsePairs(env, '=')
      return { ...base, transport: 'stdio', command: command.trim(), args: parseLines(args), ...(Object.keys(envMap).length ? { env: envMap } : {}) }
    }
    const headerMap = parsePairs(headers, ':')
    return { ...base, transport: 'http', url: url.trim(), ...(Object.keys(headerMap).length ? { headers: headerMap } : {}) }
  }

  const valid = transport === 'stdio' ? command.trim().length > 0 : /^https?:\/\//.test(url.trim())

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    const result = await window.api.testMcpServer(build())
    setTestResult(result.ok ? { tools: result.tools } : { error: result.error })
    setTesting(false)
  }

  return (
    <>
      <div className="field">
        <label className="label">Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="FreeCAD" />
      </div>
      <div className="field">
        <span className="label">Transport</span>
        <div>
          <div className="segmented">
            <button type="button" className={transport === 'stdio' ? 'active' : ''} onClick={() => setTransport('stdio')}>
              Local command
            </button>
            <button type="button" className={transport === 'http' ? 'active' : ''} onClick={() => setTransport('http')}>
              HTTP
            </button>
          </div>
        </div>
      </div>
      {transport === 'stdio' ? (
        <>
          <div className="field">
            <label className="label">Command</label>
            <input className="input mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
          </div>
          <div className="field">
            <label className="label">Arguments (one per line)</label>
            <textarea className="textarea" style={{ minHeight: 70 }} value={args} onChange={(e) => setArgs(e.target.value)} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/Users/me/projects'} spellCheck={false} />
          </div>
          <div className="field">
            <label className="label">Environment (KEY=value per line)</label>
            <textarea className="textarea" style={{ minHeight: 50 }} value={env} onChange={(e) => setEnv(e.target.value)} spellCheck={false} />
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label className="label">URL</label>
            <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
          </div>
          <div className="field">
            <label className="label">Headers (Name: value per line)</label>
            <textarea className="textarea" style={{ minHeight: 50 }} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder="Authorization: Bearer …" spellCheck={false} />
          </div>
        </>
      )}
      {testResult && 'error' in testResult && <div className="error-text" style={{ marginBottom: 12 }}>{testResult.error}</div>}
      {testResult && 'tools' in testResult && (
        <div className="small muted" style={{ marginBottom: 12 }}>
          Connected. {testResult.tools.length} tool{testResult.tools.length === 1 ? '' : 's'}:{' '}
          <span className="mono">{testResult.tools.map((t) => t.name).join(', ') || 'none'}</span>
        </div>
      )}
      <div className="row">
        <button type="button" className="btn" disabled={!valid || testing} onClick={() => void test()}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => void onSave(build())}>
          Save
        </button>
      </div>
    </>
  )
}

function McpTab() {
  const servers = useUiStore((s) => s.settings?.mcpServers ?? [])
  const [editing, setEditing] = useState<{ config: McpServerConfig; isNew: boolean } | null>(null)

  const persist = (list: McpServerConfig[]): Promise<void> => useUiStore.getState().updateSettings({ mcpServers: list })

  if (editing) {
    return (
      <ServerForm
        initial={editing.config}
        onCancel={() => setEditing(null)}
        onSave={async (config) => {
          await persist(editing.isNew ? [...servers, config] : servers.map((s) => (s.id === config.id ? config : s)))
          setEditing(null)
        }}
      />
    )
  }

  return (
    <>
      {servers.length === 0 && (
        <div className="small muted" style={{ marginBottom: 12 }}>
          No MCP servers yet. Add a local command (stdio) or a remote URL (streamable HTTP).
        </div>
      )}
      {servers.map((s) => (
        <div className="list-item" key={s.id}>
          <div className="grow">
            <div>{s.name}</div>
            <div className="small faint mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.transport === 'stdio' ? [s.command, ...s.args].join(' ') : s.url}
            </div>
          </div>
          <button type="button" className="btn btn-small" onClick={() => setEditing({ config: s, isNew: false })}>
            Edit
          </button>
          <button
            type="button"
            className="btn btn-small btn-ghost"
            onClick={() => {
              if (window.confirm(`Remove "${s.name}"?`)) void persist(servers.filter((x) => x.id !== s.id))
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => setEditing({ config: { id: newId(), name: '', transport: 'stdio', command: '', args: [] }, isNew: true })}
      >
        Add server
      </button>
    </>
  )
}

function LimitsTab() {
  const limits = useUiStore((s) => s.settings?.limits)
  if (!limits) return null
  const set = (patch: Partial<RunLimits>): void => {
    void useUiStore.getState().updateSettings({ limits: { ...limits, ...patch } })
  }
  const field = (key: keyof RunLimits, label: string, help: string) => (
    <div className="field" key={key}>
      <label className="label">{label}</label>
      <input
        className="input"
        type="number"
        min={1}
        value={limits[key]}
        onChange={(e) => {
          const value = Number(e.target.value)
          if (Number.isFinite(value) && value >= 1) set({ [key]: Math.floor(value) })
        }}
      />
      <div className="small faint">{help}</div>
    </div>
  )
  return (
    <>
      {field('maxTurns', 'Max turns per agent', 'Model calls one agent may make in a single execution before the run stops. Nodes can override this.')}
      {field('maxDelegationDepth', 'Max delegation depth', 'How deep delegate calls may nest.')}
      {field('maxTotalSteps', 'Max total steps per run', 'Total model calls across the whole run. Guarantees cyclic graphs terminate.')}
    </>
  )
}

export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen)
  const setOpen = useUiStore((s) => s.setSettingsOpen)
  const [tab, setTab] = useState<Tab>('keys')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="dialog">
        <div className="dialog-header">
          <span>Settings</span>
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => setOpen(false)} title="Close (Esc)">
            ×
          </button>
        </div>
        <div className="dialog-tabs">
          {TABS.map((t) => (
            <button key={t.id} type="button" className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="dialog-body">{tab === 'keys' ? <KeysTab /> : tab === 'mcp' ? <McpTab /> : <LimitsTab />}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Add it to the app**

`src/renderer/App.tsx`:
```tsx
import { useEffect } from 'react'
import '@/styles/theme.css'
import '@/styles/app.css'
import { useUiStore } from '@/store/ui'
import { TopBar } from '@/components/TopBar'
import { Canvas } from '@/components/Canvas'
import { Inspector } from '@/components/Inspector'
import { RunConsole } from '@/components/RunConsole'
import { SettingsDialog } from '@/components/SettingsDialog'

export default function App() {
  const loadSettings = useUiStore((s) => s.loadSettings)
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  return (
    <div className="app">
      <TopBar />
      <Canvas />
      <Inspector />
      <RunConsole />
      <SettingsDialog />
    </div>
  )
}
```

- [ ] **Step 6: Verify**

Run: `npx vitest run src/renderer/lib/kv.test.ts && npm run typecheck && npm run build && npm test`
Expected: clean.

Run `npm run dev` and check: ⚙ opens the dialog; saving a key marks the provider configured and the model combo refreshes from the API; adding an MCP server with "Test connection" lists its tools (for a quick local test use command `npx` with args `-y` and `@modelcontextprotocol/server-everything` on separate lines); the server then appears in a node's Tools section and its tools can be checked; limits persist across restarts. With a real key, a two-node graph (entry with a handoff edge to a second node) runs end to end with streaming text in the console and the active node pulsing on the canvas. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/kv.ts src/renderer/lib/kv.test.ts src/renderer/components/SettingsDialog.tsx src/renderer/App.tsx
git commit -m "Add settings dialog for API keys, MCP servers, and limits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: Packaging and README

**Files:**
- Create: `electron-builder.yml`, `README.md`

**Interfaces:**
- Produces: `npm run package` builds a macOS app (unsigned) into `dist/`.

- [ ] **Step 1: Write the builder config**

`electron-builder.yml`:
```yaml
appId: com.agentgraph.app
productName: Agent Graph
directories:
  output: dist
files:
  - out/**
  - package.json
asar: true
npmRebuild: false
mac:
  category: public.app-category.developer-tools
  identity: null
  target:
    - dmg
    - dir
```

- [ ] **Step 2: Write the README**

`README.md`:
```markdown
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
```

- [ ] **Step 3: Verify the full build and package**

Run: `npm run typecheck && npm test && npm run package 2>&1 | tail -20`
Expected: tests pass; electron-builder prints `building target=DMG` and finishes without errors; `ls dist` shows a `.dmg` and a `mac-arm64` (or `mac`) directory containing `Agent Graph.app`. Packaging can take a few minutes the first time because electron-builder downloads its helper binaries.

Then run: `open "dist/mac-arm64/Agent Graph.app"` (adjust the directory to what `ls dist` shows).
Expected: the packaged app launches, remembers the theme, and opens the settings dialog.

- [ ] **Step 4: Commit**

```bash
git add electron-builder.yml README.md
git commit -m "Add packaging config and README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
