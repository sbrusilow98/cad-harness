import { create } from 'zustand'
import type { RunEvent } from '@shared/events'
import { applyRunEvent, initialRunState, type RunState } from '@shared/run-transcript'

export * from '@shared/run-transcript'

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
