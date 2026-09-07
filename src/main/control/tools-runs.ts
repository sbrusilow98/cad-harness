import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { hasErrors, validateGraph } from '../runtime/validate'
import type { RunRecord } from '../run-service'
import type { ControlDeps } from './deps'
import { fail, ok } from './result'

const DEFAULT_TIMEOUT_SECONDS = 300

function describeRun(record: RunRecord): unknown {
  return {
    runId: record.id,
    status: record.status,
    input: record.input,
    output: record.output,
    error: record.error,
    warnings: record.warnings,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    executions: record.executions.map((execution) => ({
      agentId: execution.nodeId,
      depth: execution.depth,
      input: execution.input,
      text: execution.text,
      status: execution.status,
      error: execution.error,
      toolCalls: execution.toolCalls.map((call) => ({
        name: call.name,
        args: call.args,
        result: call.result,
        isError: call.isError
      })),
      handoffs: execution.markers
    }))
  }
}

export function registerRunTools(server: McpServer, deps: ControlDeps): void {
  server.registerTool(
    'run_graph',
    {
      description:
        'Run the open graph from its entry agent. Waits for the result by default and returns the full transcript; the run also streams into the app window.',
      inputSchema: {
        input: z.string(),
        wait: z.boolean().optional(),
        timeoutSeconds: z.number().optional()
      }
    },
    async ({ input, wait, timeoutSeconds }) => {
      const document = deps.document.get()
      const issues = validateGraph(document.graph)
      if (hasErrors(issues)) {
        return fail(
          `This graph cannot run yet: ${issues
            .filter((i) => i.level === 'error')
            .map((i) => i.message)
            .join(' ')}`
        )
      }
      const runId = deps.runs.start(document.graph, input)
      if (wait === false) return ok({ runId, status: 'running' })

      const seconds = timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
      const record = await deps.runs.wait(runId, Math.max(0, seconds) * 1000)
      if (!record) return fail(`Run ${runId} disappeared before it could be read.`)
      const described = describeRun(record) as Record<string, unknown>
      if (record.status === 'running') {
        described['note'] = `Still running after ${seconds}s. Call get_run with this runId to read it later, or stop_run to end it.`
      }
      return ok(described)
    }
  )

  server.registerTool(
    'get_run',
    { description: 'Read a run and its transcript by id.', inputSchema: { runId: z.string() } },
    ({ runId }) => {
      const record = deps.runs.get(runId)
      return record ? ok(describeRun(record)) : fail(`No run with id "${runId}".`)
    }
  )

  server.registerTool(
    'stop_run',
    { description: 'Stop a run that is still going.', inputSchema: { runId: z.string() } },
    ({ runId }) => {
      if (!deps.runs.stop(runId)) return fail(`No run with id "${runId}".`)
      return ok({ runId, stopped: true })
    }
  )

  server.registerTool(
    'list_runs',
    { description: 'List recent runs, newest first, without their transcripts.', inputSchema: { limit: z.number().optional() } },
    ({ limit }) =>
      ok({
        runs: deps.runs.list(limit).map((summary) => ({
          runId: summary.id,
          status: summary.status,
          input: summary.input,
          output: summary.output,
          error: summary.error,
          startedAt: summary.startedAt,
          finishedAt: summary.finishedAt
        }))
      })
  )
}

export { describeRun }
