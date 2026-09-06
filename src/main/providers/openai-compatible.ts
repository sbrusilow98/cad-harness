import OpenAI from 'openai'
import type { ProviderId } from '@shared/types'
import { textOf, toolCallsOf, type AssistantPart, type ChatProvider, type ChatResponse, type Message, type StopReason, type ToolDef } from './types'

type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam
type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk

export interface OpenAICompatibleOptions {
  id: ProviderId
  baseURL?: string
  maxTokensParam: 'max_completion_tokens' | 'max_tokens'
  filterModels?: (id: string) => boolean
}

export function toOpenAITools(tools: ToolDef[]): ChatTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema }
  }))
}

export function toOpenAIMessages(system: string, messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = []
  if (system.trim()) out.push({ role: 'system', content: system })
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      const text = textOf(m.parts)
      const calls = toolCallsOf(m.parts)
      const msg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = { role: 'assistant', content: text || null }
      if (calls.length > 0) {
        msg.tool_calls = calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args) }
        }))
      }
      out.push(msg)
    } else {
      for (const r of m.results) {
        out.push({ role: 'tool', tool_call_id: r.callId, content: r.isError ? `Error: ${r.content}` : r.content })
      }
    }
  }
  return out
}

export interface ChunkAccumulator {
  text: string
  calls: Map<number, { id: string; name: string; args: string }>
  finish: string | null
}

export function newAccumulator(): ChunkAccumulator {
  return { text: '', calls: new Map(), finish: null }
}

export function feedChunk(acc: ChunkAccumulator, chunk: Chunk): string {
  const choice = chunk.choices?.[0]
  if (!choice) return ''
  const delta = choice.delta ?? {}
  const textDelta = delta.content ?? ''
  acc.text += textDelta
  for (const tc of delta.tool_calls ?? []) {
    const entry = acc.calls.get(tc.index) ?? { id: '', name: '', args: '' }
    if (tc.id) entry.id = tc.id
    if (tc.function?.name) entry.name = tc.function.name
    if (tc.function?.arguments) entry.args += tc.function.arguments
    acc.calls.set(tc.index, entry)
  }
  if (choice.finish_reason) acc.finish = choice.finish_reason
  return textDelta
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

export function finishAccumulator(acc: ChunkAccumulator): ChatResponse {
  const parts: AssistantPart[] = []
  if (acc.text) parts.push({ type: 'text', text: acc.text })
  const indexes = [...acc.calls.keys()].sort((a, b) => a - b)
  for (const index of indexes) {
    const c = acc.calls.get(index)!
    parts.push({ type: 'tool_call', id: c.id || `call_${index}`, name: c.name, args: parseArgs(c.args) })
  }
  let stopReason: StopReason = 'end'
  if (indexes.length > 0) stopReason = 'tool_use'
  else if (acc.finish === 'length') stopReason = 'max_tokens'
  else if (acc.finish === 'content_filter') stopReason = 'refusal'
  return { parts, stopReason }
}

const CHAT_MODEL_PREFIX = /^(gpt-|chatgpt-|o\d)/
const NON_CHAT_MODALITY = /(audio|realtime|tts|transcribe|image|embedding|moderation|instruct|-search)/

export function isOpenAIChatModel(id: string): boolean {
  const base = id.startsWith('ft:') ? id.slice(3).split(':')[0] : id
  return CHAT_MODEL_PREFIX.test(base) && !NON_CHAT_MODALITY.test(base)
}

export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): ChatProvider {
  return {
    id: opts.id,

    async listModels(apiKey, signal) {
      const client = new OpenAI({ apiKey, baseURL: opts.baseURL })
      const ids: string[] = []
      for await (const model of client.models.list({ signal })) ids.push(model.id)
      const keep = opts.filterModels ?? (() => true)
      return ids.filter(keep).sort()
    },

    async chat(req, onTextDelta) {
      const client = new OpenAI({ apiKey: req.apiKey, baseURL: opts.baseURL, maxRetries: 2 })
      const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        model: req.model,
        messages: toOpenAIMessages(req.system, req.messages),
        stream: true
      }
      if (req.tools.length > 0) body.tools = toOpenAITools(req.tools)
      if (req.temperature !== undefined) body.temperature = req.temperature
      if (req.maxTokens !== undefined) body[opts.maxTokensParam] = req.maxTokens

      const stream = await client.chat.completions.create(body, { signal: req.signal })
      const acc = newAccumulator()
      for await (const chunk of stream) {
        const delta = feedChunk(acc, chunk)
        if (delta) onTextDelta(delta)
      }
      return finishAccumulator(acc)
    }
  }
}

export const fireworksProvider = createOpenAICompatibleProvider({
  id: 'fireworks',
  baseURL: 'https://api.fireworks.ai/inference/v1',
  maxTokensParam: 'max_tokens'
})
