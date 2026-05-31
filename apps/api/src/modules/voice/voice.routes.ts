import {
  canUseVoiceAssistant,
  parseSafeVoiceMetricEvent,
  VoiceMetricPayloadError,
} from '@planner/contracts'
import type { FastifyInstance } from 'fastify'

import { HttpError } from '../../bootstrap/http-error.js'
import { requireRequestAuth } from '../../bootstrap/request-auth.js'
import { resolveRouteWriteContext } from '../../bootstrap/route-context.js'
import type { SessionService } from '../session/index.js'
import type {
  VoiceCommandAudioMetadata,
  VoiceRequestSecurity,
} from './voice.model.js'
import {
  COMMAND_AUDIO_FORMAT,
  COMMAND_AUDIO_HARD_LIMIT_BYTES,
  createVoiceCommandError,
  parseVoiceCommandSource,
} from './voice.model.js'
import type { VoiceCommandService } from './voice.service.js'

const VOICE_COMMAND_CONTENT_TYPES = [
  'application/octet-stream',
  'audio/l16',
  'audio/lpcm',
  'audio/pcm',
] as const
const VOICE_METRICS_MAX_BATCH_EVENTS = 1
const VOICE_METRICS_PAYLOAD_LIMIT_BYTES = 16 * 1024
const VOICE_METRICS_RATE_LIMIT_MAX_EVENTS = 120
const VOICE_METRICS_RATE_LIMIT_WINDOW_MS = 60_000

export function registerVoiceRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: VoiceCommandService,
): void {
  const metricsRateLimiter = new VoiceMetricsRateLimiter()

  for (const contentType of VOICE_COMMAND_CONTENT_TYPES) {
    if (!app.hasContentTypeParser(contentType)) {
      app.addContentTypeParser(
        contentType,
        { parseAs: 'buffer' },
        (_request, body, done) => {
          done(null, body)
        },
      )
    }
  }

  app.post(
    '/api/voice/command',
    { bodyLimit: COMMAND_AUDIO_HARD_LIMIT_BYTES },
    async (request) => {
      requireRequestAuth(request)
      const context = await resolveRouteWriteContext(request, sessionService)

      if (!canUseVoiceAssistant(context.appRole)) {
        service.recordAuditEvent('voice_feature_forbidden', {
          appRole: context.appRole,
          source:
            readStringHeader(request.headers['x-stt-source']) ?? 'unknown',
        })
        throw new HttpError(
          403,
          'voice_feature_forbidden',
          'Voice input is available only for global owner and test users.',
        )
      }

      const body = request.body

      if (!Buffer.isBuffer(body)) {
        throw createVoiceCommandError('UNSUPPORTED_AUDIO_FORMAT')
      }

      return service.process({
        audio: {
          data: body,
          metadata: createAudioMetadata(request.headers),
        },
        context: {
          actorUserId: context.actorUserId,
          appRole: context.appRole,
          clientNow:
            readStringHeader(request.headers['x-client-now']) ?? undefined,
          deviceId:
            readStringHeader(request.headers['x-device-id']) ?? undefined,
          ipAddress: request.ip,
          isDeviceLocked: readBooleanHeader(request.headers['x-device-locked']),
          timezone:
            readStringHeader(request.headers['x-client-timezone']) ?? undefined,
          workspaceId: context.workspaceId,
        },
        security: createVoiceRequestSecurity(request.headers),
        source: parseVoiceCommandSource(
          readStringHeader(request.headers['x-stt-source']),
        ),
      })
    },
  )

  app.post(
    '/api/voice/metrics',
    { bodyLimit: VOICE_METRICS_PAYLOAD_LIMIT_BYTES },
    async (request) => {
      requireRequestAuth(request)
      const context = await resolveRouteWriteContext(request, sessionService)

      if (!canUseVoiceAssistant(context.appRole)) {
        throw new HttpError(
          403,
          'voice_feature_forbidden',
          'Voice input is available only for global owner and test users.',
        )
      }

      if (Array.isArray(request.body)) {
        throw new HttpError(
          400,
          'voice_metric_batch_too_large',
          'Voice metrics endpoint accepts one event per request.',
          {
            maxEventsPerBatch: VOICE_METRICS_MAX_BATCH_EVENTS,
            receivedEvents: request.body.length,
          },
        )
      }

      try {
        metricsRateLimiter.assertAllowed(
          createVoiceMetricRateLimitKey({
            actorUserId: context.actorUserId,
            deviceId:
              readStringHeader(request.headers['x-device-id']) ?? undefined,
            ipAddress: request.ip,
            workspaceId: context.workspaceId,
          }),
        )
      } catch {
        throw new HttpError(
          429,
          'voice_metric_rate_limited',
          'Voice metrics rate limit exceeded.',
          {
            limit: VOICE_METRICS_RATE_LIMIT_MAX_EVENTS,
            windowMs: VOICE_METRICS_RATE_LIMIT_WINDOW_MS,
          },
        )
      }

      let event

      try {
        event = parseSafeVoiceMetricEvent(request.body)
      } catch (error) {
        if (error instanceof VoiceMetricPayloadError) {
          throw new HttpError(
            400,
            error.code,
            'Voice metric payload failed safe telemetry validation.',
            error.details,
          )
        }

        throw error
      }

      if (event.appRole !== context.appRole) {
        throw new HttpError(
          400,
          'voice_metric_role_mismatch',
          'Voice metric appRole must match the authenticated session role.',
        )
      }

      service.recordRuntimeMetric(event)

      return { ok: true }
    },
  )
}

function createVoiceRequestSecurity(
  headers: Record<string, string | string[] | undefined>,
): VoiceRequestSecurity {
  const requestId = readStringHeader(headers['x-voice-request-id'])
  const sessionId = readStringHeader(headers['x-voice-session-id'])
  const issuedAt = readStringHeader(headers['x-voice-issued-at'])

  if (!requestId || !sessionId || !issuedAt) {
    throw createVoiceCommandError('REPLAY_REJECTED', {
      reason: 'missing_security_headers',
    })
  }

  return {
    issuedAt,
    requestId,
    sessionId,
  }
}

function createAudioMetadata(
  headers: Record<string, string | string[] | undefined>,
): VoiceCommandAudioMetadata {
  const durationMs = readNumberHeader(headers['x-audio-duration-ms'])
  const metadata = {
    format: {
      bitsPerSample:
        readNumberHeader(headers['x-audio-bits-per-sample']) ??
        COMMAND_AUDIO_FORMAT.bitsPerSample,
      byteOrder:
        readStringHeader(headers['x-audio-byte-order']) ??
        COMMAND_AUDIO_FORMAT.byteOrder,
      channelCount:
        readNumberHeader(headers['x-audio-channel-count']) ??
        COMMAND_AUDIO_FORMAT.channelCount,
      encoding:
        readStringHeader(headers['x-audio-encoding']) ??
        COMMAND_AUDIO_FORMAT.encoding,
      sampleRateHertz:
        readNumberHeader(headers['x-audio-sample-rate']) ??
        COMMAND_AUDIO_FORMAT.sampleRateHertz,
    },
  }

  return durationMs === undefined ? metadata : { ...metadata, durationMs }
}

function readBooleanHeader(
  value: string | string[] | undefined,
): boolean | undefined {
  const rawValue = readStringHeader(value)

  if (!rawValue) {
    return undefined
  }

  if (rawValue === '1' || rawValue.toLowerCase() === 'true') {
    return true
  }

  if (rawValue === '0' || rawValue.toLowerCase() === 'false') {
    return false
  }

  return undefined
}

function readStringHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0]?.trim() || null
  }

  return value?.trim() || null
}

function readNumberHeader(
  value: string | string[] | undefined,
): number | undefined {
  const rawValue = readStringHeader(value)

  if (!rawValue) {
    return undefined
  }

  const parsed = Number(rawValue)

  return Number.isFinite(parsed) ? parsed : undefined
}

function createVoiceMetricRateLimitKey(input: {
  actorUserId: string | undefined
  deviceId: string | undefined
  ipAddress: string | undefined
  workspaceId: string
}): string {
  return [
    input.actorUserId ?? input.workspaceId,
    input.deviceId ?? 'unknown-device',
    input.ipAddress ?? 'unknown-ip',
  ].join(':')
}

class VoiceMetricsRateLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; resetAt: number }
  >()

  assertAllowed(key: string): void {
    const now = Date.now()

    this.cleanup(now)

    const current = this.buckets.get(key)

    if (!current || current.resetAt <= now) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + VOICE_METRICS_RATE_LIMIT_WINDOW_MS,
      })
      return
    }

    if (current.count >= VOICE_METRICS_RATE_LIMIT_MAX_EVENTS) {
      throw new Error('voice_metric_rate_limited')
    }

    current.count += 1
  }

  private cleanup(now: number): void {
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key)
      }
    }
  }
}
