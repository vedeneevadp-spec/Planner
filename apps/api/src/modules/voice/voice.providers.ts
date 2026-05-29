import { z } from 'zod'

import type { VoiceSttConfig } from '../../bootstrap/config.js'
import type {
  BackendSttProvider,
  BackendSttProviderInput,
  BackendSttProviderResult,
} from './voice.model.js'
import { createVoiceCommandError } from './voice.model.js'

const yandexRecognizeResponseSchema = z
  .object({
    result: z.string().optional(),
  })
  .passthrough()

export class YandexSpeechKitProvider implements BackendSttProvider {
  constructor(private readonly config: VoiceSttConfig) {}

  isAvailable(): boolean {
    return Boolean(
      this.config.endpoint &&
      (this.config.apiKey || (this.config.iamToken && this.config.folderId)),
    )
  }

  async transcribe(
    input: BackendSttProviderInput,
  ): Promise<BackendSttProviderResult> {
    if (!this.isAvailable()) {
      throw createVoiceCommandError('SERVER_STT_UNAVAILABLE')
    }

    const url = new URL(this.config.endpoint)
    url.searchParams.set('format', 'lpcm')
    url.searchParams.set(
      'sampleRateHertz',
      String(input.audio.format.sampleRateHertz),
    )
    url.searchParams.set('lang', this.config.language)

    if (!this.config.apiKey && this.config.folderId) {
      url.searchParams.set('folderId', this.config.folderId)
    }

    try {
      const response = await fetch(url, {
        body: input.audio.data,
        headers: {
          Authorization: this.createAuthorizationHeader(),
          'Content-Type': 'audio/l16',
        },
        method: 'POST',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })

      if (response.status === 429) {
        throw createVoiceCommandError('RATE_LIMITED')
      }

      if (!response.ok) {
        throw createVoiceCommandError('SERVER_STT_UNAVAILABLE', {
          provider: 'yandex_speechkit',
          status: response.status,
        })
      }

      const body = yandexRecognizeResponseSchema.parse(await response.json())
      const transcript = body.result?.trim() ?? ''

      if (!transcript) {
        throw createVoiceCommandError('NO_SPEECH')
      }

      return {
        confidence: null,
        provider: 'backend_yandex_speechkit',
        transcript,
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw createVoiceCommandError('NETWORK_ERROR', {
          provider: 'yandex_speechkit',
          reason: 'timeout',
        })
      }

      if (error instanceof Error && error.name === 'HttpError') {
        throw error
      }

      if (
        error instanceof Error &&
        'sttError' in error &&
        typeof error.sttError === 'string'
      ) {
        throw error
      }

      throw createVoiceCommandError('NETWORK_ERROR', {
        provider: 'yandex_speechkit',
      })
    }
  }

  private createAuthorizationHeader(): string {
    if (this.config.apiKey) {
      return `Api-Key ${this.config.apiKey}`
    }

    if (this.config.iamToken) {
      return `Bearer ${this.config.iamToken}`
    }

    throw createVoiceCommandError('SERVER_STT_UNAVAILABLE')
  }
}
