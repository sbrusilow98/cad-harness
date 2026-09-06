import { describe, it, expect } from 'vitest'
import type OpenAI from 'openai'
import {
  toResponsesInput,
  toResponsesTools,
  newResponsesAccumulator,
  feedResponsesEvent,
  finishResponsesAccumulator
} from './openai-responses'
import type { Message } from './types'

type StreamEvent = OpenAI.Responses.ResponseStreamEvent
type FinalResponse = OpenAI.Responses.Response

function textDelta(delta: string): StreamEvent {
  return { type: 'response.output_text.delta', delta } as unknown as StreamEvent
}

/** The item shapes are typed so a misspelled field fails the build, not just the assertion. */
function completed(output: OpenAI.Responses.ResponseOutputItem[], incomplete: FinalResponse['incomplete_details'] = null): StreamEvent {
  return {
    type: 'response.completed',
    response: { output, incomplete_details: incomplete } as unknown as FinalResponse
  } as unknown as StreamEvent
}

function failed(message: string): StreamEvent {
  return {
    type: 'response.failed',
    response: { output: [], error: { code: 'server_error', message } } as unknown as FinalResponse
  } as unknown as StreamEvent
}

function message(...content: OpenAI.Responses.ResponseOutputMessage['content']): OpenAI.Responses.ResponseOutputItem {
  return { type: 'message', id: 'm1', role: 'assistant', status: 'completed', content }
}

function functionCall(callId: string, name: string, args: string): OpenAI.Responses.ResponseOutputItem {
  return { type: 'function_call', call_id: callId, name, arguments: args }
}

function outputText(text: string): OpenAI.Responses.ResponseOutputText {
  return { type: 'output_text', text, annotations: [] }
}

describe('toResponsesTools', () => {
  it('emits flat function tools', () => {
    expect(toResponsesTools([{ name: 'read', description: 'Reads', inputSchema: { type: 'object' } }])).toEqual([
      { type: 'function', name: 'read', description: 'Reads', parameters: { type: 'object' }, strict: false }
    ])
  })
})

describe('toResponsesInput', () => {
  it('flattens messages, tool calls and results into linked items', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', parts: [{ type: 'text', text: 'checking' }, { type: 'tool_call', id: 'call_1', name: 'read', args: { p: 1 } }] },
      { role: 'tool', results: [{ callId: 'call_1', content: 'data' }] }
    ]
    expect(toResponsesInput(messages)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'checking' },
      { type: 'function_call', call_id: 'call_1', name: 'read', arguments: '{"p":1}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'data' }
    ])
  })

  it('omits an empty assistant text and marks failed or empty results', () => {
    const messages: Message[] = [
      { role: 'assistant', parts: [{ type: 'tool_call', id: 'c1', name: 'x', args: {} }] },
      { role: 'tool', results: [{ callId: 'c1', content: 'boom', isError: true }, { callId: 'c2', content: '' }] }
    ]
    expect(toResponsesInput(messages)).toEqual([
      { type: 'function_call', call_id: 'c1', name: 'x', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c1', output: 'Error: boom' },
      { type: 'function_call_output', call_id: 'c2', output: '(no output)' }
    ])
  })
})

describe('response streaming', () => {
  it('reports text deltas and builds parts from the final response', () => {
    const acc = newResponsesAccumulator()
    expect(feedResponsesEvent(acc, textDelta('Hel'))).toBe('Hel')
    expect(feedResponsesEvent(acc, textDelta('lo'))).toBe('lo')
    feedResponsesEvent(acc, completed([message(outputText('Hello'))]))
    expect(finishResponsesAccumulator(acc)).toEqual({ parts: [{ type: 'text', text: 'Hello' }], stopReason: 'end' })
  })

  it('extracts function calls with parsed arguments', () => {
    const acc = newResponsesAccumulator()
    feedResponsesEvent(
      acc,
      completed([{ type: 'reasoning', id: 'r1', summary: [] }, functionCall('call_a', 'read', '{"path":"/x"}')])
    )
    expect(finishResponsesAccumulator(acc)).toEqual({
      parts: [{ type: 'tool_call', id: 'call_a', name: 'read', args: { path: '/x' } }],
      stopReason: 'tool_use'
    })
  })

  it('maps refusal and truncation, and tolerates malformed arguments', () => {
    const refusal = newResponsesAccumulator()
    feedResponsesEvent(refusal, completed([message({ type: 'refusal', refusal: 'no' })]))
    expect(finishResponsesAccumulator(refusal).stopReason).toBe('refusal')

    const truncated = newResponsesAccumulator()
    feedResponsesEvent(truncated, completed([message(outputText('x'))], { reason: 'max_output_tokens' }))
    expect(finishResponsesAccumulator(truncated).stopReason).toBe('max_tokens')

    const filtered = newResponsesAccumulator()
    feedResponsesEvent(filtered, completed([message(outputText('x'))], { reason: 'content_filter' }))
    expect(finishResponsesAccumulator(filtered).stopReason).toBe('refusal')

    const bad = newResponsesAccumulator()
    feedResponsesEvent(bad, completed([functionCall('c', 'f', '{oops')]))
    expect(finishResponsesAccumulator(bad).parts).toEqual([{ type: 'tool_call', id: 'c', name: 'f', args: {} }])
  })

  it('falls back to streamed text when no terminal event arrives', () => {
    const acc = newResponsesAccumulator()
    feedResponsesEvent(acc, textDelta('partial'))
    expect(finishResponsesAccumulator(acc)).toEqual({ parts: [{ type: 'text', text: 'partial' }], stopReason: 'end' })
  })
})

describe('failed responses', () => {
  it('throws with the API error rather than reporting an empty successful turn', () => {
    const acc = newResponsesAccumulator()
    feedResponsesEvent(acc, failed('The model is overloaded.'))
    expect(() => finishResponsesAccumulator(acc)).toThrow('The model is overloaded.')
  })

  it('reports a refusal even when the model also emitted a tool call', () => {
    const acc = newResponsesAccumulator()
    feedResponsesEvent(acc, completed([message({ type: 'refusal', refusal: 'no' }), functionCall('c1', 'f', '{}')]))
    expect(finishResponsesAccumulator(acc).stopReason).toBe('refusal')
  })
})
