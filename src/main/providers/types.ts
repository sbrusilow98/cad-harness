import type { ProviderId } from '@shared/types'

export interface TextPart {
  type: 'text'
  text: string
}

export interface ToolCallPart {
  type: 'tool_call'
  id: string
  name: string
  args: Record<string, unknown>
}

export type AssistantPart = TextPart | ToolCallPart

export interface ToolResult {
  callId: string
  content: string
  isError?: boolean
}

/** Provider-native assistant content, replayed verbatim on the next turn of the same provider. */
export interface RawAssistantContent {
  provider: ProviderId
  content: unknown
}

export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; parts: AssistantPart[]; raw?: RawAssistantContent }
  | { role: 'tool'; results: ToolResult[] }

export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal'

export interface ChatRequest {
  apiKey: string
  model: string
  system: string
  messages: Message[]
  tools: ToolDef[]
  temperature?: number
  maxTokens?: number
  signal: AbortSignal
}

export interface ChatResponse {
  parts: AssistantPart[]
  stopReason: StopReason
  raw?: RawAssistantContent
}

export interface ChatProvider {
  id: ProviderId
  listModels(apiKey: string, signal?: AbortSignal): Promise<string[]>
  chat(req: ChatRequest, onTextDelta: (text: string) => void): Promise<ChatResponse>
}

export function textOf(parts: AssistantPart[]): string {
  return parts
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

export function toolCallsOf(parts: AssistantPart[]): ToolCallPart[] {
  return parts.filter((p): p is ToolCallPart => p.type === 'tool_call')
}
