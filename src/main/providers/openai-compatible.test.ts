import { describe, it, expect } from 'vitest'
import type OpenAI from 'openai'
import { toOpenAIMessages, toOpenAITools, newAccumulator, feedChunk, finishAccumulator, isOpenAIChatModel } from './openai-compatible'
import type { Message } from './types'

type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk

function chunk(delta: Record<string, unknown>, finish: string | null = null): Chunk {
  return { id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] } as unknown as Chunk
}

describe('toOpenAITools', () => {
  it('wraps tools as functions', () => {
    expect(toOpenAITools([{ name: 'a', description: 'd', inputSchema: { type: 'object' } }])).toEqual([
      { type: 'function', function: { name: 'a', description: 'd', parameters: { type: 'object' } } }
    ])
  })
})

describe('toOpenAIMessages', () => {
  it('prepends the system prompt only when non-empty', () => {
    expect(toOpenAIMessages('', [{ role: 'user', content: 'hi' }])).toEqual([{ role: 'user', content: 'hi' }])
    expect(toOpenAIMessages('be nice', [{ role: 'user', content: 'hi' }])).toEqual([
      { role: 'system', content: 'be nice' },
      { role: 'user', content: 'hi' }
    ])
  })

  it('maps assistant tool calls and tool results', () => {
    const msgs: Message[] = [
      { role: 'assistant', parts: [{ type: 'text', text: 'checking' }, { type: 'tool_call', id: 'call_1', name: 'read', args: { p: 1 } }] },
      { role: 'tool', results: [{ callId: 'call_1', content: 'data' }, { callId: 'call_2', content: 'bad', isError: true }] },
      { role: 'assistant', parts: [{ type: 'tool_call', id: 'call_3', name: 'x', args: {} }] }
    ]
    expect(toOpenAIMessages('', msgs)).toEqual([
      {
        role: 'assistant',
        content: 'checking',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"p":1}' } }]
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'data' },
      { role: 'tool', tool_call_id: 'call_2', content: 'Error: bad' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_3', type: 'function', function: { name: 'x', arguments: '{}' } }] }
    ])
  })
})

describe('chunk accumulation', () => {
  it('accumulates text and reports deltas', () => {
    const acc = newAccumulator()
    expect(feedChunk(acc, chunk({ role: 'assistant', content: 'Hel' }))).toBe('Hel')
    expect(feedChunk(acc, chunk({ content: 'lo' }, 'stop'))).toBe('lo')
    expect(finishAccumulator(acc)).toEqual({ parts: [{ type: 'text', text: 'Hello' }], stopReason: 'end' })
  })

  it('assembles streamed tool calls by index', () => {
    const acc = newAccumulator()
    feedChunk(acc, chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'read', arguments: '' } }] }))
    feedChunk(acc, chunk({ tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }))
    feedChunk(acc, chunk({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'list', arguments: '{}' } }] }))
    feedChunk(acc, chunk({ tool_calls: [{ index: 0, function: { arguments: '"/x"}' } }] }, 'tool_calls'))
    expect(finishAccumulator(acc)).toEqual({
      parts: [
        { type: 'tool_call', id: 'call_a', name: 'read', args: { path: '/x' } },
        { type: 'tool_call', id: 'call_b', name: 'list', args: {} }
      ],
      stopReason: 'tool_use'
    })
  })

  it('tolerates malformed arguments and missing ids', () => {
    const acc = newAccumulator()
    feedChunk(acc, chunk({ tool_calls: [{ index: 0, function: { name: 'f', arguments: '{oops' } }] }, 'tool_calls'))
    expect(finishAccumulator(acc).parts).toEqual([{ type: 'tool_call', id: 'call_0', name: 'f', args: {} }])
  })

  it('maps length and content_filter finish reasons', () => {
    const a = newAccumulator()
    feedChunk(a, chunk({ content: 'x' }, 'length'))
    expect(finishAccumulator(a).stopReason).toBe('max_tokens')
    const b = newAccumulator()
    feedChunk(b, chunk({}, 'content_filter'))
    expect(finishAccumulator(b).stopReason).toBe('refusal')
  })

  it('ignores chunks without choices', () => {
    const acc = newAccumulator()
    expect(feedChunk(acc, { choices: [] } as unknown as Chunk)).toBe('')
  })
})

describe('isOpenAIChatModel', () => {
  it('keeps chat models and drops other modalities', () => {
    expect(isOpenAIChatModel('gpt-5')).toBe(true)
    expect(isOpenAIChatModel('o3-mini')).toBe(true)
    expect(isOpenAIChatModel('gpt-4o-audio-preview')).toBe(false)
    expect(isOpenAIChatModel('text-embedding-3-small')).toBe(false)
    expect(isOpenAIChatModel('gpt-image-1')).toBe(false)
  })
})
