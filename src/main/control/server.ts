import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ControlDeps } from './deps'
import { describeDocument, registerDocumentTools } from './tools-document'

export const CONTROL_SERVER_INFO = { name: 'agent-graph', version: '0.1.0' } as const

/** Builds a control server bound to one set of dependencies. Cheap: one is made per HTTP request. */
export function buildControlServer(deps: ControlDeps): McpServer {
  const server = new McpServer(CONTROL_SERVER_INFO, {
    instructions:
      'Controls the Agent Graph desktop app. Edit the graph open in the window, run it, and read the transcript. Agents and edges can be named instead of given by id.'
  })

  registerDocumentTools(server, deps)

  server.registerResource(
    'document',
    'agentgraph://document',
    { title: 'Open graph', description: 'The graph currently open in the app.', mimeType: 'application/json' },
    () => ({
      contents: [
        {
          uri: 'agentgraph://document',
          mimeType: 'application/json',
          text: JSON.stringify(describeDocument(deps.document.get()), null, 2)
        }
      ]
    })
  )

  return server
}
