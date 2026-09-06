import { describe, it, expect } from 'vitest'
import { supportsTemperature } from './model-capabilities'

describe('supportsTemperature', () => {
  it('rejects temperature on the Claude models that removed sampling', () => {
    const models = ['claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-mythos-5', 'claude-haiku-5', 'claude-opus-6']
    for (const model of models) {
      expect(supportsTemperature('anthropic', model)).toBe(false)
    }
  })

  it('keeps temperature on older Claude models', () => {
    for (const model of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-5', 'claude-3-5-sonnet-20240620']) {
      expect(supportsTemperature('anthropic', model)).toBe(true)
    }
  })

  it('rejects temperature on OpenAI reasoning models but keeps it for the gpt-4 family', () => {
    expect(supportsTemperature('openai', 'gpt-6-astra')).toBe(false)
    expect(supportsTemperature('openai', 'gpt-5-mini')).toBe(false)
    expect(supportsTemperature('openai', 'o3-mini')).toBe(false)
    expect(supportsTemperature('openai', 'codex-mini-latest')).toBe(false)
    expect(supportsTemperature('openai', 'ft:gpt-5:acme::abc')).toBe(false)
    expect(supportsTemperature('openai', 'gpt-4.1')).toBe(true)
    expect(supportsTemperature('openai', 'chatgpt-4o-latest')).toBe(true)
  })

  it('leaves Fireworks models alone', () => {
    expect(supportsTemperature('fireworks', 'accounts/fireworks/models/deepseek-v3')).toBe(true)
  })
})
