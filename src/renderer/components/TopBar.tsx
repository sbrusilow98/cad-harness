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
    const wasOpen = consoleOpen
    setConsoleOpen(true)
    // The console is always mounted (it renders null while hidden but keeps
    // its listeners), so when it was closed we just need to give React a tick
    // to re-render it as open before its RUN_EVENT handler tries to focus the
    // input.
    if (wasOpen) window.dispatchEvent(new Event(RUN_EVENT))
    else setTimeout(() => window.dispatchEvent(new Event(RUN_EVENT)), 0)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.repeat) return
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
      // Only signal that the unload needs confirming; main decides with a
      // native dialog in its `will-prevent-unload` handler. Chromium
      // suppresses window.confirm() inside beforeunload.
      if (useGraphStore.getState().dirty) {
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
