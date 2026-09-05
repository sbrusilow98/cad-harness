import Anthropic from '@anthropic-ai/sdk'
import type { AssistantPart, ChatProvider, ChatResponse, Message, StopReason, ToolDef } from './types'

export const DEFAULT_MAX_TOKENS = 16000

export function toAnthropicTools(tools: ToolDef[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { ...t.inputSchema, type: 'object' } as Anthropic.Tool.InputSchema
  }))
}

export function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    switch (m.role) {
      case 'user':
        return { role: 'user', content: m.content }
      case 'assistant': {
        if (m.raw?.provider === 'anthropic') {
          return { role: 'assistant', content: m.raw.content as Anthropic.ContentBlockParam[] }
        }
        const content: Anthropic.ContentBlockParam[] = []
        for (const part of m.parts) {
          if (part.type === 'text') {
            if (part.text.length > 0) content.push({ type: 'text', text: part.text })
          } else {
            content.push({ type: 'tool_use', id: part.id, name: part.name, input: part.args })
          }
        }
        if (content.length === 0) content.push({ type: 'text', text: '(no output)' })
        return { role: 'assistant', content }
      }
      case 'tool':
        return {
          role: 'user',
          content: m.results.map((r): Anthropic.ToolResultBlockParam => ({
            type: 'tool_result',
            tool_use_id: r.callId,
            content: r.content.length > 0 ? r.content : '(no output)',
            ...(r.isError ? { is_error: true } : {})
          }))
        }
    }
  })
}

function mapStopReason(reason: Anthropic.StopReason | null): StopReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_use'
    case 'max_tokens':
      return 'max_tokens'
    case 'refusal':
      return 'refusal'
    default:
      return 'end'
  }
}

export function fromAnthropicMessage(msg: Anthropic.Message): ChatResponse {
  const parts: AssistantPart[] = []
  for (const block of msg.content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'tool_use') {
      parts.push({ type: 'tool_call', id: block.id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> })
    }
  }
  return { parts, stopReason: mapStopReason(msg.stop_reason), raw: { provider: 'anthropic', content: msg.content } }
}

export const anthropicProvider: ChatProvider = {
  id: 'anthropic',

  async listModels(apiKey, signal) {
    const client = new Anthropic({ apiKey })
    const ids: string[] = []
    for await (const model of client.models.list({ limit: 100 }, { signal })) ids.push(model.id)
    return ids
  },

  async chat(req, onTextDelta) {
    const client = new Anthropic({ apiKey: req.apiKey, maxRetries: 2 })
    const params: Anthropic.MessageStreamParams = {
      model: req.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: toAnthropicMessages(req.messages)
    }
    if (req.system.trim()) params.system = req.system
    if (req.tools.length > 0) params.tools = toAnthropicTools(req.tools)
    if (req.temperature !== undefined) params.temperature = req.temperature

    const stream = client.messages.stream(params, { signal: req.signal })
    stream.on('text', (delta) => onTextDelta(delta))
    const final = await stream.finalMessage()
    return fromAnthropicMessage(final)
  }
}
