import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ControlDeps } from './deps'
import { describeDocument, registerDocumentTools } from './tools-document'
import { describeRun, registerRunTools } from './tools-runs'
import { registerSettingsTools } from './tools-settings'

export const CONTROL_SERVER_INFO = { name: 'agent-graph', version: '0.1.0' } as const

/** Builds a control server bound to one set of dependencies. Cheap: one is made per HTTP request. */
export function buildControlServer(deps: ControlDeps): McpServer {
  const server = new McpServer(CONTROL_SERVER_INFO, {
    instructions:
      'Controls the Agent Graph desktop app. Edit the graph open in the window, run it, and read the transcript. Agents and edges can be named instead of given by id.'
  })

  registerDocumentTools(server, deps)
  registerRunTools(server, deps)
  registerSettingsTools(server, deps)

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

  server.registerResource(
    'run',
    new ResourceTemplate('agentgraph://runs/{runId}', { list: undefined }),
    { title: 'Run transcript', description: 'One run and its transcript.', mimeType: 'application/json' },
    (uri, variables) => {
      const runId = String(variables['runId'])
      const record = deps.runs.get(runId)
      if (!record) throw new Error(`No run with id "${runId}".`)
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(describeRun(record), null, 2) }]
      }
    }
  )

  return server
}
