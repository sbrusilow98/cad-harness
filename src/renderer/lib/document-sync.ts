import { useEffect } from 'react'
import { useGraphStore } from '@/store/graph'

/**
 * Keeps the main process's copy of the open document in step with this window. Local edits are
 * reported upward; documents pushed down are applied without being reported back, so an edit made
 * here cannot echo and an edit made over MCP lands on the canvas.
 */
export function useDocumentSync(): void {
  useEffect(() => {
    let applying = false

    const stopListening = window.api.onDocumentChanged((document) => {
      applying = true
      try {
        useGraphStore.getState().applyRemote(document.graph, document.path, document.dirty)
      } finally {
        applying = false
      }
    })

    const report = (): void => {
      const { graph, path, dirty } = useGraphStore.getState()
      window.api.syncDocument({ graph, path, dirty })
    }

    report()
    const unsubscribe = useGraphStore.subscribe((state, previous) => {
      if (applying) return
      if (state.graph === previous.graph && state.path === previous.path && state.dirty === previous.dirty) return
      report()
    })

    return () => {
      stopListening()
      unsubscribe()
    }
  }, [])
}
