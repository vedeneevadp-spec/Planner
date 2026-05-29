import {
  commandAudioSchema,
  type PlannerIntent,
  PlannerIntentParser,
  type PlannerIntentParserContext,
  type SttSource,
  validatePlannerIntent,
  type VoiceCommandResponse,
  voiceCommandResponseSchema,
} from '@planner/contracts'

import type {
  BackendSttProvider,
  CommandAudioClip,
  VoiceCommandAudioMetadata,
  VoiceCommandRouteContext,
} from './voice.model.js'
import {
  COMMAND_AUDIO_BYTES_PER_SECOND,
  COMMAND_AUDIO_FORMAT,
  COMMAND_AUDIO_MAX_BYTES,
  COMMAND_AUDIO_MAX_DURATION_MS,
  COMMAND_AUDIO_MIN_DURATION_MS,
  createVoiceCommandError,
} from './voice.model.js'

const SILENCE_ABSOLUTE_PEAK = 12
const QUIET_ABSOLUTE_PEAK = 420
const VOICE_ABSOLUTE_PEAK = 700
const QUIET_RMS = 0.0035
const VOICE_RMS = 0.006
const VOICED_SAMPLE_RATIO = 0.006
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 30

export interface ProcessVoiceCommandInput {
  audio: {
    data: Buffer
    metadata: VoiceCommandAudioMetadata
  }
  context: VoiceCommandRouteContext
  source?: SttSource
}

export interface VoiceCommandMetricsSink {
  record(event: string, details?: Record<string, unknown>): void
}

export interface BackendPlannerIntentFallback {
  parseText(input: {
    context: PlannerIntentParserContext
    transcript: string
  }): Promise<unknown>
}

export class VoiceCommandService {
  private readonly parser = new PlannerIntentParser()
  private readonly rateLimiter = new VoiceCommandRateLimiter()

  constructor(
    private readonly provider: BackendSttProvider,
    private readonly metrics: VoiceCommandMetricsSink = noopMetrics,
    private readonly intentFallback: BackendPlannerIntentFallback | null = null,
  ) {}

  async process(
    input: ProcessVoiceCommandInput,
  ): Promise<VoiceCommandResponse> {
    this.rateLimiter.assertAllowed(getRateLimitKey(input.context))

    const audio = validateCommandAudio(input.audio.data, input.audio.metadata)

    this.metrics.record('stt_upload_started', {
      byteLength: audio.byteLength,
      durationMs: audio.durationMs,
      workspaceId: input.context.workspaceId,
    })

    if (!this.provider.isAvailable()) {
      this.metrics.record('stt_error', {
        code: 'SERVER_STT_UNAVAILABLE',
        workspaceId: input.context.workspaceId,
      })
      throw createVoiceCommandError('SERVER_STT_UNAVAILABLE')
    }

    const stt = await this.provider.transcribe({ audio })
    const transcript = normalizeTranscript(stt.transcript)

    if (!transcript) {
      this.metrics.record('stt_error', {
        code: 'NO_SPEECH',
        workspaceId: input.context.workspaceId,
      })
      throw createVoiceCommandError('NO_SPEECH')
    }

    const billableSecondsEstimated = Math.max(
      1,
      Math.ceil(audio.durationMs / 1000),
    )
    const parserContext = createPlannerIntentParserContext(input)
    const intent = await this.parseIntent(transcript, parserContext)

    if (intent.confidence < 0.55) {
      this.metrics.record('stt_low_confidence', {
        confidence: intent.confidence,
        workspaceId: input.context.workspaceId,
      })
    }

    this.metrics.record('stt_billable_request_estimated', {
      billableSecondsEstimated,
      provider: stt.provider,
      workspaceId: input.context.workspaceId,
    })
    this.metrics.record('stt_upload_completed', {
      durationMs: audio.durationMs,
      provider: stt.provider,
      workspaceId: input.context.workspaceId,
    })

    return voiceCommandResponseSchema.parse({
      intent,
      stt: {
        billableSecondsEstimated,
        confidence: stt.confidence,
        durationMs: audio.durationMs,
        provider: stt.provider,
        source: input.source ?? 'android_short_clip',
        transcript,
      },
      transcript,
    })
  }

  private async parseIntent(
    transcript: string,
    context: PlannerIntentParserContext,
  ): Promise<PlannerIntent> {
    const ruleIntent = this.parser.parse(transcript, context)

    if (!shouldUseBackendIntentFallback(ruleIntent) || !this.intentFallback) {
      return ruleIntent
    }

    try {
      const fallbackOutput = await this.intentFallback.parseText({
        context,
        transcript,
      })
      const fallbackIntent = validatePlannerIntent(fallbackOutput)

      if (fallbackIntent.confidence >= ruleIntent.confidence) {
        return fallbackIntent
      }
    } catch {
      this.metrics.record('intent_fallback_invalid')
    }

    return ruleIntent
  }
}

export function validateCommandAudio(
  data: Buffer,
  metadata: VoiceCommandAudioMetadata,
): CommandAudioClip {
  if (!isSupportedFormat(metadata.format) || data.byteLength % 2 !== 0) {
    throw createVoiceCommandError('UNSUPPORTED_AUDIO_FORMAT', {
      byteLength: data.byteLength,
      format: metadata.format,
    })
  }

  if (data.byteLength > COMMAND_AUDIO_MAX_BYTES) {
    throw createVoiceCommandError('TOO_LONG', {
      byteLength: data.byteLength,
      maxBytes: COMMAND_AUDIO_MAX_BYTES,
    })
  }

  const durationMs = Math.round(
    (data.byteLength / COMMAND_AUDIO_BYTES_PER_SECOND) * 1000,
  )

  if (durationMs < COMMAND_AUDIO_MIN_DURATION_MS) {
    throw createVoiceCommandError('TOO_SHORT', {
      durationMs,
      minDurationMs: COMMAND_AUDIO_MIN_DURATION_MS,
    })
  }

  if (durationMs > COMMAND_AUDIO_MAX_DURATION_MS) {
    throw createVoiceCommandError('TOO_LONG', {
      durationMs,
      maxDurationMs: COMMAND_AUDIO_MAX_DURATION_MS,
    })
  }

  const activity = analyzePcm16Le(data)

  if (activity.peak <= SILENCE_ABSOLUTE_PEAK || activity.voicedRatio === 0) {
    throw createVoiceCommandError('NO_SPEECH', {
      durationMs,
      peak: activity.peak,
      rms: activity.rms,
      voicedRatio: activity.voicedRatio,
    })
  }

  if (activity.isTooQuiet) {
    throw createVoiceCommandError('TOO_QUIET', {
      durationMs,
      peak: activity.peak,
      rms: activity.rms,
      voicedRatio: activity.voicedRatio,
    })
  }

  if (!activity.hasVoiceActivity) {
    throw createVoiceCommandError('NO_SPEECH', {
      durationMs,
      peak: activity.peak,
      rms: activity.rms,
      voicedRatio: activity.voicedRatio,
    })
  }

  const audio = {
    byteLength: data.byteLength,
    data,
    durationMs,
    format: COMMAND_AUDIO_FORMAT,
    hasVoiceActivity: true,
    isTooQuiet: false,
  }

  commandAudioSchema.parse(audio)

  return audio
}

interface PcmActivity {
  hasVoiceActivity: boolean
  isTooQuiet: boolean
  peak: number
  rms: number
  voicedRatio: number
}

function analyzePcm16Le(data: Buffer): PcmActivity {
  let peak = 0
  let sumSquares = 0
  let voicedSamples = 0
  const sampleCount = data.byteLength / 2

  for (let offset = 0; offset < data.byteLength; offset += 2) {
    const sample = data.readInt16LE(offset)
    const absolute = Math.abs(sample)

    peak = Math.max(peak, absolute)
    sumSquares += sample * sample

    if (absolute >= VOICE_ABSOLUTE_PEAK) {
      voicedSamples += 1
    }
  }

  const rms = Math.sqrt(sumSquares / sampleCount) / 32768
  const voicedRatio = voicedSamples / sampleCount
  const isTooQuiet = peak < QUIET_ABSOLUTE_PEAK || rms < QUIET_RMS
  const hasVoiceActivity =
    peak >= VOICE_ABSOLUTE_PEAK &&
    rms >= VOICE_RMS &&
    voicedRatio >= VOICED_SAMPLE_RATIO

  return {
    hasVoiceActivity,
    isTooQuiet,
    peak,
    rms,
    voicedRatio,
  }
}

function isSupportedFormat(
  format: VoiceCommandAudioMetadata['format'],
): boolean {
  return (
    format.bitsPerSample === COMMAND_AUDIO_FORMAT.bitsPerSample &&
    format.byteOrder === COMMAND_AUDIO_FORMAT.byteOrder &&
    format.channelCount === COMMAND_AUDIO_FORMAT.channelCount &&
    format.encoding === COMMAND_AUDIO_FORMAT.encoding &&
    format.sampleRateHertz === COMMAND_AUDIO_FORMAT.sampleRateHertz
  )
}

function normalizeTranscript(transcript: string): string {
  return transcript.trim().replace(/\s+/g, ' ')
}

function createPlannerIntentParserContext(
  input: ProcessVoiceCommandInput,
): PlannerIntentParserContext {
  return {
    appRole: input.context.appRole,
    isDeviceLocked: input.context.isDeviceLocked,
    locale: 'ru-RU',
    now: new Date(),
    source: getPlannerIntentParserSource(input.source),
    timezone: 'Europe/Moscow',
  }
}

function getPlannerIntentParserSource(
  source: SttSource | undefined,
): PlannerIntentParserContext['source'] {
  switch (source) {
    case 'android_push_to_talk':
      return 'android_push_to_talk'
    case 'android_short_clip':
      return 'android_wake_word'
    case 'local_fallback':
    case 'test_stub':
    case undefined:
      return 'backend_text'
  }
}

function shouldUseBackendIntentFallback(intent: PlannerIntent): boolean {
  if (intent.isDangerous) {
    return false
  }

  return intent.confidence < 0.6 || intent.intent === 'unsupported'
}

function getRateLimitKey(context: VoiceCommandRouteContext): string {
  return context.actorUserId ?? context.workspaceId
}

class VoiceCommandRateLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; resetAt: number }
  >()

  assertAllowed(key: string): void {
    const now = Date.now()
    const current = this.buckets.get(key)

    if (!current || current.resetAt <= now) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS,
      })
      return
    }

    if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
      throw createVoiceCommandError('RATE_LIMITED', {
        limit: RATE_LIMIT_MAX_REQUESTS,
        windowMs: RATE_LIMIT_WINDOW_MS,
      })
    }

    current.count += 1
  }
}

const noopMetrics: VoiceCommandMetricsSink = {
  record: () => {},
}
