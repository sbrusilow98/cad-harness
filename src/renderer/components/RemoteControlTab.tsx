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
