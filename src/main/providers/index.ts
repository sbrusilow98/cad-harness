import type { ProviderId } from '@shared/types'
import type { ModelListResult } from '@shared/ipc'
import type { ChatProvider } from './types'
import { anthropicProvider } from './anthropic'
import { fireworksProvider, openaiProvider } from './openai-compatible'
import { FALLBACK_MODELS } from './fallback-models'
import { errorMessage } from '../runtime/engine'

const providers: Record<ProviderId, ChatProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  fireworks: fireworksProvider
}

export function getProvider(id: ProviderId): ChatProvider {
  return providers[id]
}

export async function listModelsWithFallback(id: ProviderId, apiKey: string | null): Promise<ModelListResult> {
  if (!apiKey) return { models: FALLBACK_MODELS[id], source: 'fallback', error: 'No API key configured.' }
  try {
    const models = await getProvider(id).listModels(apiKey, AbortSignal.timeout(15000))
    if (models.length === 0) throw new Error('The API returned no models.')
    return { models, source: 'api' }
  } catch (err) {
    return { models: FALLBACK_MODELS[id], source: 'fallback', error: errorMessage(err) }
  }
}
