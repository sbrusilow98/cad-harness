import type { Graph } from '@shared/types'
import { emptyGraph } from '@shared/graph-defaults'
import { structuralProblem, type OpsResult } from '@shared/graph-ops'
import { errorMessage } from '@shared/errors'

export interface OpenDocument {
  graph: Graph
  path: string | null
  dirty: boolean
  /** Bumped on every change so a listener can tell one state from another. */
  revision: number
}

export type MutationResult<T> = { ok: true; value: T; document: OpenDocument } | { ok: false; error: string }

/**
 * Main's mirror of the document open in the window. The renderer stays where a human edits and
 * reports its changes here; the control surface reads and writes through `mutate`, which pushes the
 * result back to the window. Renderer syncs never push, so a local edit cannot echo.
 */
export class DocumentService {
  private document: OpenDocument = { graph: emptyGraph(), path: null, dirty: false, revision: 0 }

  constructor(private readonly push: (document: OpenDocument) => void) {}

  get(): OpenDocument {
    return this.document
  }

  syncFromRenderer(input: { graph: Graph; path: string | null; dirty: boolean }): void {
    this.document = { ...input, revision: this.document.revision + 1 }
  }

  replace(graph: Graph, path: string | null, dirty: boolean): OpenDocument {
    this.document = { graph, path, dirty, revision: this.document.revision + 1 }
    this.publish()
    return this.document
  }

  mutate<T>(fn: (graph: Graph) => OpsResult<T>): MutationResult<T> {
    const result = fn(this.document.graph)
    if (!result.ok) return result
    const problem = structuralProblem(result.graph)
    if (problem) return { ok: false, error: problem }
    this.document = { graph: result.graph, path: this.document.path, dirty: true, revision: this.document.revision + 1 }
    this.publish()
    return { ok: true, value: result.value, document: this.document }
  }

  private publish(): void {
    try {
      this.push(this.document)
    } catch (err) {
      // A closed or reloading window must not fail the mutation that reached it.
      console.error('Could not push the document to the window:', errorMessage(err))
    }
  }
}
