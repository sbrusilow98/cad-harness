import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PROVIDER_IDS, type McpServerConfig, type ProviderId } from '@shared/types'
import { newId } from '@shared/graph-defaults'
import { errorMessage } from '@shared/errors'
import type { ControlDeps } from './deps'
import { fail, ok } from './result'

/** Keeps the shape of a server visible while hiding anything that might be a credential. */
export function redactServer(config: McpServerConfig): unknown {
  const base = { id: config.id, name: config.name, transport: config.transport }
  if (config.transport === 'stdio') {
    return { ...base, command: config.command, args: config.args, envNames: Object.keys(config.env ?? {}) }
  }
  return { ...base, url: config.url, headerNames: Object.keys(config.headers ?? {}) }
}

function findServer(deps: ControlDeps, reference: string): McpServerConfig | undefined {
  const trimmed = reference.trim().toLowerCase()
  const servers = deps.settings.get().mcpServers
  return servers.find((s) => s.id === reference.trim()) ?? servers.find((s) => s.name.trim().toLowerCase() === trimmed)
}

export function registerSettingsTools(server: McpServer, deps: ControlDeps): void {
  server.registerTool(
    'list_mcp_servers',
    { description: 'List the MCP servers agents can draw tools from. Environment and header values are hidden.' },
    () => ok({ servers: deps.settings.get().mcpServers.map(redactServer) })
  )

  server.registerTool(
    'add_mcp_server',
    {
      description:
        'Add an MCP server that agents can use. The connection is tested first and the server is only saved if it answers.',
      inputSchema: {
        name: z.string(),
        transport: z.enum(['stdio', 'http']),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        url: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional()
      }
    },
    async ({ name, transport, command, args, env, url, headers }) => {
      let config: McpServerConfig
      if (transport === 'stdio') {
        if (!command?.trim()) return fail('A stdio server needs a command.')
        config = { id: newId(), name: name.trim() || 'MCP server', transport: 'stdio', command: command.trim(), args: args ?? [] }
        if (env && Object.keys(env).length > 0) config.env = env
      } else {
        if (!url?.trim()) return fail('An http server needs a url.')
        config = { id: newId(), name: name.trim() || 'MCP server', transport: 'http', url: url.trim() }
        if (headers && Object.keys(headers).length > 0) config.headers = headers
      }

      try {
        const tools = await deps.mcp.test(config)
        deps.settings.update({ mcpServers: [...deps.settings.get().mcpServers, config] })
        return ok({ ...(redactServer(config) as object), tools: tools.map((t) => t.name) })
      } catch (err) {
        return fail(`Could not connect to that server, so it was not saved: ${errorMessage(err)}`)
      }
    }
  )

  server.registerTool(
    'remove_mcp_server',
    { description: 'Remove a configured MCP server. Give it by id or name.', inputSchema: { server: z.string() } },
    async ({ server: reference }) => {
      const config = findServer(deps, reference)
      if (!config) return fail(`No MCP server matches "${reference}".`)
      deps.settings.update({ mcpServers: deps.settings.get().mcpServers.filter((s) => s.id !== config.id) })
      await deps.mcp.invalidate(config.id)
      return ok({ removedServerId: config.id })
    }
  )

  server.registerTool(
    'test_mcp_server',
    { description: 'Connect to a configured MCP server and list the tools it offers.', inputSchema: { server: z.string() } },
    async ({ server: reference }) => {
      const config = findServer(deps, reference)
      if (!config) return fail(`No MCP server matches "${reference}".`)
      try {
        const tools = await deps.mcp.test(config)
        return ok({ id: config.id, name: config.name, tools: tools.map((t) => ({ name: t.name, description: t.description })) })
      } catch (err) {
        return fail(errorMessage(err))
      }
    }
  )

  server.registerTool(
    'list_models',
    {
      description: 'List the models a provider offers. Falls back to a built-in list when no API key is configured.',
      inputSchema: { provider: z.enum(PROVIDER_IDS as [string, ...string[]]) }
    },
    async ({ provider }) => {
      const result = await deps.listModels(provider as ProviderId)
      return ok({ provider, models: result.models, source: result.source, error: result.error })
    }
  )
}
