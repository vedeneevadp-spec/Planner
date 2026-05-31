import {
  findPrivateVoiceMetricPayloadPaths,
  parseSafeVoiceMetricEvent,
  redactVoiceMetricPayload,
  safeVoiceMetricEventSchema,
  TestVoiceMetricsSink,
  VoiceMetricPayloadError,
} from '@planner/contracts'
import { describe, expect, it, vi } from 'vitest'

import {
  BackendVoiceMetricsSink,
  bucketVoiceMetricConfidence,
  bucketVoiceMetricDuration,
  createVoiceRuntimeMetricEvent,
} from './voice-metrics'

describe('voice runtime metrics', () => {
  it('accepts only safe event names and payload fields', () => {
    const event = createVoiceRuntimeMetricEvent({
      appRole: 'owner',
      audioBytes: 32_000,
      audioDurationMs: 1_000,
      confidenceBucket: bucketVoiceMetricConfidence(0.91),
      durationBucket: bucketVoiceMetricDuration(1_000),
      eventName: 'confirmation_accepted',
      intentType: 'create_task',
      platform: 'web',
      previewStatus: 'ready_for_confirmation',
      source: 'web_push_to_talk',
      time_to_confirmation_card_ms: 820,
    })

    expect(safeVoiceMetricEventSchema.safeParse(event).success).toBe(true)
    expect(event).toMatchObject({
      confidenceBucket: 'high',
      durationBucket: 'normal',
      eventName: 'confirmation_accepted',
    })
  })

  it('keeps confirmation, local validation, undo, voice cue, and LLM fallback events in contract', () => {
    for (const eventName of [
      'confirmation_accepted',
      'confirmation_cancelled',
      'confirmation_edited',
      'local_validation_failed',
      'undo_success',
      'undo_failed',
      'voice_cue_listening_played',
      'voice_cue_done_played',
      'voice_cue_suppressed',
      'llm_fallback_requested',
      'llm_fallback_used',
      'llm_fallback_rejected_schema',
      'llm_fallback_rejected_safety',
      'llm_fallback_latency_ms',
      'llm_fallback_provider_error',
      'llm_fallback_cost_estimated',
    ] as const) {
      expect(
        safeVoiceMetricEventSchema.safeParse({
          appRole: 'test',
          createdAt: '2026-06-01T00:00:00.000Z',
          eventName,
          platform: 'backend',
          source: 'backend_text',
        }).success,
        eventName,
      ).toBe(true)
    }
  })

  it('rejects private runtime metric payloads and full domain objects', () => {
    const unsafePayload = {
      appRole: 'owner',
      createdAt: '2026-06-01T00:00:00.000Z',
      eventName: 'intent_parsed',
      fullIntent: { rawText: 'секретная команда' },
      intent: {
        intent: 'create_task',
        rawText: 'секретная команда',
        title: 'секретная задача',
      },
      platform: 'web',
      preview: { title: 'секретная задача' },
      result: { visualStatus: 'Готово' },
      source: 'web_push_to_talk',
      transcript: 'секретная команда',
    }

    expect(() => parseSafeVoiceMetricEvent(unsafePayload)).toThrow(
      VoiceMetricPayloadError,
    )
    expect(findPrivateVoiceMetricPayloadPaths(unsafePayload)).toEqual(
      expect.arrayContaining([
        'fullIntent',
        'intent',
        'preview',
        'result',
        'transcript',
      ]),
    )
  })

  it('recursively redacts nested private fields before audit serialization', () => {
    const redacted = redactVoiceMetricPayload({
      metadata: {
        nested: {
          rawText: 'перенеси секретный договор',
          target_query: 'секретный договор',
          taskTitle: 'секретный договор',
        },
        safeCode: 'requires_unlock',
      },
      previewStatus: 'requires_unlock',
    })

    const serialized = JSON.stringify(redacted)

    expect(serialized).toContain('requires_unlock')
    expect(serialized).not.toContain('секретный договор')
    expect(serialized).not.toContain('rawText')
    expect(serialized).not.toContain('target_query')
    expect(serialized).not.toContain('taskTitle')
  })

  it('keeps locked-screen metrics free of private text', () => {
    const event = createVoiceRuntimeMetricEvent({
      appRole: 'owner',
      errorCode: 'requires_unlock',
      eventName: 'confirmation_shown',
      intentType: 'reschedule_task',
      platform: 'android',
      previewStatus: 'requires_unlock',
      source: 'android_wake_word',
      wake_detected_to_confirmation_card_ms: 900,
      wakeWordProvider: 'custom_onnx',
    })

    const serialized = JSON.stringify(event)

    expect(serialized).toContain('requires_unlock')
    expect(serialized).not.toContain('секретный договор')
    expect(serialized).not.toContain('targetQuery')
    expect(serialized).not.toContain('transcript')
  })

  it('stores only parsed safe events in the test sink', () => {
    const sink = new TestVoiceMetricsSink()
    const event = createVoiceRuntimeMetricEvent({
      appRole: 'test',
      eventName: 'voice_cue_suppressed',
      platform: 'web',
      source: 'web_push_to_talk',
    })

    sink.track(event)

    expect(sink.events).toEqual([event])
  })

  it('sends backend metrics through the safe endpoint', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
    )
    const sink = new BackendVoiceMetricsSink(
      {
        actorUserId: 'user-1',
        apiBaseUrl: 'http://127.0.0.1:3001',
        workspaceId: 'workspace-1',
      },
      fetchFn,
    )

    await sink.track(
      createVoiceRuntimeMetricEvent({
        appRole: 'owner',
        eventName: 'confirmation_shown',
        platform: 'web',
        source: 'web_push_to_talk',
        time_to_confirmation_card_ms: 750,
      }),
    )

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [, request] = fetchFn.mock.calls[0]!
    const requestBody = typeof request?.body === 'string' ? request.body : ''

    expect(requestBody).not.toContain('transcript')
    expect(request?.method).toBe('POST')
  })
})
