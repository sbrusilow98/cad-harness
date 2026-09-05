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
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', close)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(x, window.innerWidth - 180))
  const top = Math.max(8, Math.min(y, window.innerHeight - items.length * 32 - 12))

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
