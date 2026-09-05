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
  const [remembered, setRemembered] = useState<Record<string, string[]>>({})

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
                  onChange={(e) => {
                    if (e.target.checked) {
                      setRemembered({ ...remembered, [server.id]: names })
                      setGrant(server.id, { serverId: server.id, names: '*' })
                    } else {
                      const restore = remembered[server.id] ?? []
                      setGrant(server.id, restore.length > 0 ? { serverId: server.id, names: restore } : null)
                    }
                  }}
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
                          setRemembered({ ...remembered, [server.id]: next })
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
