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
    useUiStore.getState().requestFitView()
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
