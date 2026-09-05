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
