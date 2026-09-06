import type { ProviderId } from './types'

/**
 * Models that reject `temperature` with an error instead of ignoring it. Anthropic removed
 * sampling parameters across the Claude 5 generation and on Opus 4.7 and 4.8; OpenAI rejects
 * it on its reasoning models.
 */
const REJECTS_TEMPERATURE: Record<ProviderId, RegExp | null> = {
  // Every Claude family from major version 5 on, plus Opus 4.7 and 4.8.
  anthropic: /^claude-[a-z]+-([5-9]|\d{2,})|^claude-opus-4-[78]/,
  // The o-series, GPT-5 and newer, and the codex models.
  openai: /^(o\d|codex-|gpt-([5-9]|\d{2,}))/,
  fireworks: null
}

/** Strips a fine-tune wrapper so `ft:gpt-5:acme::abc` is judged as `gpt-5`. */
function baseModel(model: string): string {
  const trimmed = model.trim()
  return trimmed.startsWith('ft:') ? trimmed.slice(3).split(':')[0] : trimmed
}

export function supportsTemperature(provider: ProviderId, model: string): boolean {
  const pattern = REJECTS_TEMPERATURE[provider]
  return pattern ? !pattern.test(baseModel(model)) : true
}
