import OpenAI from 'openai'
import { textOf, toolCallsOf, type AssistantPart, type ChatProvider, type ChatResponse, type Message, type StopReason, type ToolDef } from './types'
import { isOpenAIChatModel } from './openai-compatible'

type ResponseInput = OpenAI.Responses.ResponseInput
type ResponseItem = OpenAI.Responses.ResponseInputItem
type StreamEvent = OpenAI.Responses.ResponseStreamEvent
type FinalResponse = OpenAI.Responses.Response

export function toResponsesTools(tools: ToolDef[]): OpenAI.Responses.FunctionTool[] {
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
    strict: false
  }))
}

/**
 * The Responses API takes a flat list of items rather than chat messages: assistant tool calls and
 * their results are siblings of the messages, linked by `call_id`.
 */
export function toResponsesInput(messages: Message[]): ResponseInput {
  const input: ResponseItem[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      input.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      const text = textOf(m.parts)
      if (text) input.push({ role: 'assistant', content: text })
      for (const call of toolCallsOf(m.parts)) {
        input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.args) })
      }
    } else {
      for (const r of m.results) {
        input.push({
          type: 'function_call_output',
          call_id: r.callId,
          output: r.isError ? `Error: ${r.content || 'the tool reported a failure.'}` : r.content || '(no output)'
        })
      }
    }
  }
  return input
}

export interface ResponsesAccumulator {
  text: string
  response: FinalResponse | null
}

export function newResponsesAccumulator(): ResponsesAccumulator {
  return { text: '', response: null }
}

/** Feeds one stream event and returns the text delta it carried, if any. */
export function feedResponsesEvent(acc: ResponsesAccumulator, event: StreamEvent): string {
  if (event.type === 'response.output_text.delta') {
    acc.text += event.delta
    return event.delta
  }
  if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') {
    acc.response = event.response
  }
  return ''
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function finishResponsesAccumulator(acc: ResponsesAccumulator): ChatResponse {
  const parts: AssistantPart[] = []
  let refused = false

  if (acc.response) {
    for (const item of acc.response.output) {
      if (item.type === 'message') {
        for (const content of item.content) {
          if (content.type === 'output_text') parts.push({ type: 'text', text: content.text })
          else if (content.type === 'refusal') refused = true
        }
      } else if (item.type === 'function_call') {
        parts.push({ type: 'tool_call', id: item.call_id, name: item.name, args: parseArgs(item.arguments) })
      }
    }
  } else if (acc.text) {
    // The stream ended without a terminal event; fall back to what was streamed.
    parts.push({ type: 'text', text: acc.text })
  }

  let stopReason: StopReason = 'end'
  if (parts.some((p) => p.type === 'tool_call')) stopReason = 'tool_use'
  else if (refused) stopReason = 'refusal'
  else if (acc.response?.incomplete_details?.reason === 'max_output_tokens') stopReason = 'max_tokens'

  return { parts, stopReason }
}

export const openaiProvider: ChatProvider = {
  id: 'openai',

  async listModels(apiKey, signal) {
    const client = new OpenAI({ apiKey })
    const ids: string[] = []
    for await (const model of client.models.list({ signal })) ids.push(model.id)
    return ids.filter(isOpenAIChatModel).sort()
  },

  async chat(req, onTextDelta) {
    const client = new OpenAI({ apiKey: req.apiKey, maxRetries: 2 })
    const body: OpenAI.Responses.ResponseCreateParamsStreaming = {
      model: req.model,
      input: toResponsesInput(req.messages),
      stream: true,
      store: false
    }
    if (req.system.trim()) body.instructions = req.system
    if (req.tools.length > 0) body.tools = toResponsesTools(req.tools)
    if (req.temperature !== undefined) body.temperature = req.temperature
    if (req.maxTokens !== undefined) body.max_output_tokens = req.maxTokens

    const stream = await client.responses.create(body, { signal: req.signal })
    const acc = newResponsesAccumulator()
    for await (const event of stream) {
      const delta = feedResponsesEvent(acc, event)
      if (delta) onTextDelta(delta)
    }
    return finishResponsesAccumulator(acc)
  }
}
