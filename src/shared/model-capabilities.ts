import type { ProviderId } from './types'

/**
 * Model families that reject `temperature` with an error instead of ignoring it.
 * Anthropic removed sampling parameters on Fable/Mythos 5.x, Opus 5 / 4.8 / 4.7 and Sonnet 5;
 * OpenAI rejects it on the reasoning models (the o-series and GPT-5 and newer).
 */
const REJECTS_TEMPERATURE: Record<ProviderId, RegExp | null> = {
  anthropic: /^claude-(fable|mythos)-5|^claude-opus-(5|4-8|4-7)|^claude-sonnet-5/,
  openai: /^(o\d|gpt-([5-9]|\d{2,}))/,
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

/**
 * OpenAI reasoning models cannot use function tools through Chat Completions; they need the
 * Responses API. The OpenAI adapter uses Responses for every model, so this only marks which
 * models would break on the older endpoint.
 */
export function requiresResponsesApi(provider: ProviderId, model: string): boolean {
  return provider === 'openai' && /^(o\d|gpt-([5-9]|\d{2,}))/.test(baseModel(model))
}
