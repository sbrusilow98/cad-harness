import { useCallback, useEffect, useState } from 'react'
import { PROVIDER_IDS, PROVIDER_LABELS, type McpServerConfig, type ProviderId, type RunLimits } from '@shared/types'
import type { McpToolSummary } from '@shared/ipc'
import { newId } from '@shared/graph-defaults'
import { useUiStore } from '@/store/ui'
import { describeError } from '@/lib/errors'
import { formatPairs, parseLines, parsePairs } from '@/lib/kv'
import { RemoteControlTab } from './RemoteControlTab'

type Tab = 'keys' | 'mcp' | 'limits' | 'remote'
const TABS: { id: Tab; label: string }[] = [
  { id: 'keys', label: 'API keys' },
  { id: 'mcp', label: 'MCP servers' },
  { id: 'limits', label: 'Limits' },
  { id: 'remote', label: 'Remote control' }
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
    setError(null)
    try {
      await window.api.clearSecret(id)
      void useUiStore.getState().fetchModels(id, true)
      await refresh()
    } catch (err) {
      setError(describeError(err))
    }
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
          {id === 'anthropic' && <WorkspaceIdField />}
        </div>
      ))}
      {error && <div className="error-text">{error}</div>}
    </>
  )
}

function WorkspaceIdField() {
  const saved = useUiStore((s) => s.settings?.anthropicWorkspaceId ?? '')
  const [draft, setDraft] = useState(saved)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(saved)
  }, [saved])

  const commit = async (): Promise<void> => {
    const value = draft.trim()
    if (value === saved) return
    setError(null)
    try {
      await useUiStore.getState().updateSettings({ anthropicWorkspaceId: value })
      void useUiStore.getState().fetchModels('anthropic', true)
    } catch (err) {
      setError(describeError(err))
    }
  }

  return (
    <div style={{ marginTop: 6 }}>
      <input
        className="input mono"
        placeholder="Workspace ID (only for keys not scoped to a workspace)"
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit()
        }}
      />
      <div className="small faint">Sent as the anthropic-workspace-id header. Leave blank for workspace-scoped keys.</div>
      {error && <div className="error-text">{error}</div>}
    </div>
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
    try {
      const result = await window.api.testMcpServer(build())
      setTestResult(result.ok ? { tools: result.tools } : { error: result.error })
    } catch (err) {
      setTestResult({ error: describeError(err) })
    } finally {
      setTesting(false)
    }
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
  const [error, setError] = useState<string | null>(null)

  const persist = async (list: McpServerConfig[]): Promise<boolean> => {
    try {
      await useUiStore.getState().updateSettings({ mcpServers: list })
      setError(null)
      return true
    } catch (err) {
      setError(describeError(err))
      return false
    }
  }

  if (editing) {
    return (
      <ServerForm
        initial={editing.config}
        onCancel={() => setEditing(null)}
        onSave={async (config) => {
          const ok = await persist(editing.isNew ? [...servers, config] : servers.map((s) => (s.id === config.id ? config : s)))
          if (ok) setEditing(null)
        }}
      />
    )
  }

  return (
    <>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
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
  const [error, setError] = useState<string | null>(null)
  if (!limits) return null
  const set = (patch: Partial<RunLimits>): void => {
    void (async () => {
      try {
        await useUiStore.getState().updateSettings({ limits: { ...limits, ...patch } })
        setError(null)
      } catch (err) {
        setError(describeError(err))
      }
    })()
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
      {error && <div className="error-text">{error}</div>}
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
        <div className="dialog-body">
          {tab === 'keys' ? <KeysTab /> : tab === 'mcp' ? <McpTab /> : tab === 'limits' ? <LimitsTab /> : <RemoteControlTab />}
        </div>
      </div>
    </div>
  )
}
