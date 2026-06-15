import {
  type VoiceCommandResponse,
  voiceCommandResponseSchema,
} from '@planner/contracts'

import type { SessionFeatureApiConfig } from '@/features/session'
import { readResponsePayload, throwApiError } from '@/shared/lib/api-client'
import { resolveClientTimeZone } from '@/shared/lib/date'

import {
  WEB_VOICE_BACKEND_TIMEOUT_MS,
  WEB_VOICE_SAMPLE_RATE_HERTZ,
  WEB_VOICE_SOURCE,
  type WebVoiceRecording,
} from '../model/web-voice-input'

export class WebVoiceCommandApiError extends Error {
  readonly code: string
  readonly details?: unknown
  readonly status: number

  constructor(
    message: string,
    options: {
      code: string
      details?: unknown
      status: number
    },
  ) {
    super(message)
    this.name = 'WebVoiceCommandApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export interface UploadWebVoiceCommandOptions {
  fetchFn?: typeof fetch | undefined
  issuedAt?: string | undefined
  requestId?: string | undefined
  sessionId?: string | undefined
  signal?: AbortSignal | undefined
  timeoutMs?: number | undefined
}

export async function uploadWebVoiceCommand(
  recording: WebVoiceRecording,
  config: SessionFeatureApiConfig,
  options: UploadWebVoiceCommandOptions = {},
): Promise<VoiceCommandResponse> {
  const fetchFn = options.fetchFn ?? fetch
  const abortController = createTimeoutAbortController(
    options.signal,
    options.timeoutMs ?? WEB_VOICE_BACKEND_TIMEOUT_MS,
  )

  try {
    const response = await fetchFn(
      new URL('/api/voice/command', config.apiBaseUrl),
      {
        body: recording.audio,
        headers: createVoiceCommandHeaders(recording, config, {
          issuedAt: options.issuedAt ?? new Date().toISOString(),
          requestId: options.requestId ?? createUuid(),
          sessionId: options.sessionId ?? getWebVoiceSessionId(),
        }),
        method: 'POST',
        signal: abortController.signal,
      },
    )
    const payload = await readResponsePayload(response)

    if (!response.ok) {
      throwApiError({
        createError: (message, errorOptions) =>
          new WebVoiceCommandApiError(message, errorOptions),
        fallbackCode: 'voice_command_failed',
        fallbackMessage: 'Не удалось распознать голосовую команду.',
        payload,
        response,
      })
    }

    return voiceCommandResponseSchema.parse(payload)
  } finally {
    abortController.dispose()
  }
}

export function getWebVoiceSessionId(): string {
  const fallback = createUuid()

  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const storageKey = 'planner.webVoice.sessionId.v1'
    const existing = window.sessionStorage.getItem(storageKey)

    if (existing) {
      return existing
    }

    window.sessionStorage.setItem(storageKey, fallback)

    return fallback
  } catch {
    return fallback
  }
}

function createVoiceCommandHeaders(
  recording: WebVoiceRecording,
  config: SessionFeatureApiConfig,
  security: {
    issuedAt: string
    requestId: string
    sessionId: string
  },
): Headers {
  const headers = new Headers()

  headers.set('content-type', 'audio/l16')
  headers.set('x-audio-bits-per-sample', '16')
  headers.set('x-audio-byte-order', 'little_endian')
  headers.set('x-audio-channel-count', '1')
  headers.set('x-audio-duration-ms', String(recording.durationMs))
  headers.set('x-audio-encoding', 'pcm_s16le')
  headers.set('x-audio-sample-rate', String(WEB_VOICE_SAMPLE_RATE_HERTZ))
  headers.set('x-client-now', security.issuedAt)
  headers.set('x-client-timezone', resolveClientTimezone())
  headers.set('x-device-id', `web:${security.sessionId}`)
  headers.set('x-stt-source', WEB_VOICE_SOURCE)
  headers.set('x-voice-issued-at', security.issuedAt)
  headers.set('x-voice-request-id', security.requestId)
  headers.set('x-voice-session-id', security.sessionId)
  headers.set('x-workspace-id', config.workspaceId)

  if (config.accessToken) {
    headers.set('authorization', `Bearer ${config.accessToken}`)
  } else {
    headers.set('x-actor-user-id', config.actorUserId)
  }

  return headers
}

function createTimeoutAbortController(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortController & { dispose: () => void } {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => {
    controller.abort(
      new DOMException('Voice request timed out.', 'TimeoutError'),
    )
  }, timeoutMs)

  function abortFromExternalSignal() {
    controller.abort(externalSignal?.reason)
  }

  externalSignal?.addEventListener('abort', abortFromExternalSignal, {
    once: true,
  })

  return Object.assign(controller, {
    dispose() {
      window.clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', abortFromExternalSignal)
    },
  })
}

function createUuid(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16)
    const value = token === 'x' ? random : (random & 0x3) | 0x8

    return value.toString(16)
  })
}

function resolveClientTimezone(): string {
  return resolveClientTimeZone() ?? 'UTC'
}
