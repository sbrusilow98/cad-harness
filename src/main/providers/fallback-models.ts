import type { ProviderId } from '@shared/types'

export const FALLBACK_MODELS: Record<ProviderId, string[]> = {
  anthropic: ['claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
  fireworks: [
    'accounts/fireworks/models/llama-v3p3-70b-instruct',
    'accounts/fireworks/models/deepseek-v3',
    'accounts/fireworks/models/qwen3-235b-a22b'
  ]
}
