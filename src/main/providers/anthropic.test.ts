import { describe, it, expect } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { toAnthropicMessages, toAnthropicTools, fromAnthropicMessage } from './anthropic'
import type { Message } from './types'

describe('toAnthropicTools', () => {
  it('maps tool definitions', () => {
    expect(toAnthropicTools([{ name: 'a', description: 'A tool', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } }])).toEqual([
      { name: 'a', description: 'A tool', input_schema: { type: 'object', properties: { x: { type: 'string' } } } }
    ])
  })
})

describe('toAnthropicMessages', () => {
  it('maps user messages', () => {
    expect(toAnthropicMessages([{ role: 'user', content: 'hi' }])).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('rebuilds assistant messages from parts and drops empty text', () => {
    const msgs: Message[] = [
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: '' },
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_call', id: 'toolu_1', name: 'read', args: { path: '/x' } }
        ]
      }
    ]
    expect(toAnthropicMessages(msgs)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'toolu_1', name: 'read', input: { path: '/x' } }
        ]
      }
    ])
  })

  it('replays raw Anthropic content verbatim', () => {
    const raw = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'ok' }]
    const msgs: Message[] = [{ role: 'assistant', parts: [{ type: 'text', text: 'ok' }], raw: { provider: 'anthropic', content: raw } }]
    expect(toAnthropicMessages(msgs)).toEqual([{ role: 'assistant', content: raw }])
  })

  it('ignores raw content from other providers', () => {
    const msgs: Message[] = [{ role: 'assistant', parts: [{ type: 'text', text: 'ok' }], raw: { provider: 'openai', content: { foo: 1 } } }]
    expect(toAnthropicMessages(msgs)).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }])
  })

  it('uses a placeholder when an assistant turn has no content', () => {
    expect(toAnthropicMessages([{ role: 'assistant', parts: [] }])).toEqual([{ role: 'assistant', content: [{ type: 'text', text: '(no output)' }] }])
  })

  it('maps tool results to a user message with tool_result blocks', () => {
    const msgs: Message[] = [
      {
        role: 'tool',
        results: [
          { callId: 'toolu_1', content: 'file contents' },
          { callId: 'toolu_2', content: 'boom', isError: true }
        ]
      }
    ]
    expect(toAnthropicMessages(msgs)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file contents' },
          { type: 'tool_result', tool_use_id: 'toolu_2', content: 'boom', is_error: true }
        ]
      }
    ])
  })
})

describe('fromAnthropicMessage', () => {
  it('extracts text and tool calls and keeps raw content', () => {
    const content = [
      { type: 'text', text: 'Hello', citations: null },
      { type: 'tool_use', id: 'toolu_9', name: 'search', input: { q: 'x' } }
    ]
    const msg = { content, stop_reason: 'tool_use' } as unknown as Anthropic.Message
    expect(fromAnthropicMessage(msg)).toEqual({
      parts: [
        { type: 'text', text: 'Hello' },
        { type: 'tool_call', id: 'toolu_9', name: 'search', args: { q: 'x' } }
      ],
      stopReason: 'tool_use',
      raw: { provider: 'anthropic', content }
    })
  })

  it('maps stop reasons', () => {
    const mk = (stop_reason: string) => fromAnthropicMessage({ content: [], stop_reason } as unknown as Anthropic.Message).stopReason
    expect(mk('end_turn')).toBe('end')
    expect(mk('max_tokens')).toBe('max_tokens')
    expect(mk('refusal')).toBe('refusal')
    expect(mk('stop_sequence')).toBe('end')
  })
})
