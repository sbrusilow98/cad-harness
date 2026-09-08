import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** What Windows raises when a virus scanner or the search indexer briefly holds the target open. */
const TRANSIENT_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_ATTEMPTS = 5

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function writeFileAtomic(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, data)
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        renameSync(tmp, path)
        return
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? ''
        if (attempt === RENAME_ATTEMPTS || !TRANSIENT_CODES.has(code)) throw err
        sleepSync(10 * attempt)
      }
    }
  } catch (err) {
    // Otherwise a failed save leaves a .tmp file beside the real one every time it is retried.
    rmSync(tmp, { force: true })
    throw err
  }
}
