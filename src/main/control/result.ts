import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/** Every tool answers with pretty JSON so an agent can read it without guessing. */
export function ok(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

export function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
