export function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function parsePairs(text: string, sep: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of parseLines(text)) {
    const index = line.indexOf(sep)
    if (index <= 0) continue
    out[line.slice(0, index).trim()] = line.slice(index + sep.length).trim()
  }
  return out
}

export function formatPairs(map: Record<string, string> | undefined, sep: string): string {
  return Object.entries(map ?? {})
    .map(([key, value]) => `${key}${sep}${value}`)
    .join('\n')
}
