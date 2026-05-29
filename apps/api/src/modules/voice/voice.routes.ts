import { canUseVoiceAssistant } from '@planner/contracts'
import type { FastifyInstance } from 'fastify'

import { HttpError } from '../../bootstrap/http-error.js'
import { resolveRouteWriteContext } from '../../bootstrap/route-context.js'
import type { SessionService } from '../session/index.js'
import type { VoiceCommandAudioMetadata } from './voice.model.js'
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

export function registerVoiceRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: VoiceCommandService,
): void {
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
      const context = await resolveRouteWriteContext(request, sessionService)

      if (!canUseVoiceAssistant(context.appRole)) {
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
          workspaceId: context.workspaceId,
        },
        source: parseVoiceCommandSource(
          readStringHeader(request.headers['x-stt-source']),
        ),
      })
    },
  )
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
