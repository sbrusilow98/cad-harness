/** Turns any thrown value into a message, stripping Electron's IPC prefix. */
export function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
