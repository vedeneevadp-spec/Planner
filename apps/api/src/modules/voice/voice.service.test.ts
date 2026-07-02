import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'

import type {
  BackendPlannerIntentFallback,
  BackendSttProvider,
  BackendSttProviderInput,
  BackendSttProviderResult,
} from './index.js'
import {
  COMMAND_AUDIO_FORMAT,
  validateCommandAudio,
  VoiceCommandError,
  VoiceCommandService,
} from './index.js'

void describe('VoiceCommandService', () => {
  void it('returns transcript and PlannerIntent in a single response', async () => {
    const provider = new FakeSttProvider('добавь задачу позвонить врачу завтра')
    const service = new VoiceCommandService(provider)
    const result = await service.process({
      audio: createRequestAudio(createVoiceAudio(900)),
      context: {
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
      },
      security: createSecurity(),
    })

    assert.equal(provider.callCount, 1)
    assert.equal(result.transcript, 'добавь задачу позвонить врачу завтра')
    assert.equal(result.intent.intent, 'create_task')
    assert.equal(result.intent.title, 'позвонить врачу')
    assert.equal(result.stt.provider, 'backend_yandex_speechkit')
    assert.equal(result.stt.source, 'android_short_clip')
  })

  void it('keeps the request source in the STT response', async () => {
    const service = new VoiceCommandService(
      new FakeSttProvider('добавь задачу позвонить врачу завтра'),
    )
    const result = await service.process({
      audio: createRequestAudio(createVoiceAudio(900)),
      context: {
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
      },
      security: createSecurity(),
      source: 'android_push_to_talk',
    })

    assert.equal(result.stt.source, 'android_push_to_talk')
  })

  void it('keeps web push-to-talk source in the STT response and parser context', async () => {
    const fallback = new FakePlannerIntentFallback({
      confidence: 0.91,
      intent: 'add_shopping_item',
      items: [{ title: 'овсянка' }],
      needsConfirmation: false,
      rawText: 'овсянку бы не забыть',
    })
    const service = new VoiceCommandService(
      new FakeSttProvider('овсянку бы не забыть'),
      undefined,
      fallback,
    )
    const result = await service.process({
      audio: createRequestAudio(createVoiceAudio(900)),
      context: {
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
      },
      security: createSecurity(),
      source: 'web_push_to_talk',
    })

    assert.equal(result.stt.source, 'web_push_to_talk')
    assert.equal(fallback.lastInput?.context.source, 'web_push_to_talk')
  })

  void it('uses client capture time and timezone for relative reminders', async () => {
    const service = new VoiceCommandService(
      new FakeSttProvider('через полчаса проверить духовку'),
    )
    const result = await service.process({
      audio: createRequestAudio(createVoiceAudio(900)),
      context: {
        actorUserId: 'user-1',
        clientNow: '2026-05-29T06:54:00.000Z',
        timezone: 'Asia/Novosibirsk',
        workspaceId: 'workspace-1',
      },
      security: createSecurity(),
      source: 'android_push_to_talk',
    })

    assert.equal(result.intent.intent, 'create_task')
    assert.equal(result.intent.reminderAt, '2026-05-29T14:24')
  })

  void it('uses backend intent fallback only with transcript text', async () => {
    const provider = new FakeSttProvider('овсянку бы не забыть')
    const fallback = new FakePlannerIntentFallback({
      confidence: 0.91,
      intent: 'add_shopping_item',
      items: [{ title: 'овсянка' }],
      needsConfirmation: false,
      rawText: 'овсянку бы не забыть',
    })
    const service = new VoiceCommandService(provider, undefined, fallback)
    const result = await service.process({
      audio: createRequestAudio(createVoiceAudio(900)),
      context: {
        actorUserId: 'user-1',
        appRole: 'owner',
        workspaceId: 'workspace-1',
      },
      security: createSecurity(),
      source: 'android_push_to_talk',
    })

    assert.equal(fallback.callCount, 1)
    assert.equal(fallback.lastInput?.transcript, 'овсянку бы не забыть')
    assert.equal('audio' in (fallback.lastInput ?? {}), false)
    assert.equal(fallback.lastInput?.context.source, 'android_push_to_talk')
    assert.equal(result.intent.intent, 'add_shopping_item')
  })

  void it('ignores invalid backend intent fallback output', async () => {
    const provider = new FakeSttProvider('овсянку бы не забыть')
    const fallback = new FakePlannerIntentFallback({
      intent: 'create_event',
      rawText: 'овсянку бы не забыть',
    })
    const service = new VoiceCommandService(provider, undefined, fallback)
    const result = await service.process({
      audio: createRequestAudio(createVoiceAudio(900)),
      context: {
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
      },
      security: createSecurity(),
    })

    assert.equal(fallback.callCount, 1)
    assert.equal(result.intent.intent, 'unsupported')
  })

  void it('does not call backend intent fallback for dangerous unsupported commands', async () => {
    const provider = new FakeSttProvider('удали задачу')
    const fallback = new FakePlannerIntentFallback({
      confidence: 0.91,
      intent: 'create_task',
      needsConfirmation: true,
      rawText: 'удали задачу',
      title: 'удали задачу',
    })
    const service = new VoiceCommandService(provider, undefined, fallback)
    const result = await service.process({
      audio: createRequestAudio(createVoiceAudio(900)),
      context: {
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
      },
      security: createSecurity(),
    })

    assert.equal(fallback.callCount, 0)
    assert.equal(result.intent.intent, 'unsupported')
    assert.equal(result.intent.isDangerous, true)
  })

  void it('rejects too short audio before provider upload', async () => {
    const provider = new FakeSttProvider('добавь задачу')
    const service = new VoiceCommandService(provider)

    await assert.rejects(
      () =>
        service.process({
          audio: createRequestAudio(createVoiceAudio(200)),
          context: {
            actorUserId: 'user-1',
            workspaceId: 'workspace-1',
          },
          security: createSecurity(),
        }),
      (error) => isVoiceCommandError(error, 'TOO_SHORT'),
    )
    assert.equal(provider.callCount, 0)
  })

  void it('rejects silence before provider upload', async () => {
    const provider = new FakeSttProvider('добавь задачу')
    const service = new VoiceCommandService(provider)

    await assert.rejects(
      () =>
        service.process({
          audio: createRequestAudio(Buffer.alloc(16_000 * 2)),
          context: {
            actorUserId: 'user-1',
            workspaceId: 'workspace-1',
          },
          security: createSecurity(),
        }),
      (error) => isVoiceCommandError(error, 'NO_SPEECH'),
    )
    assert.equal(provider.callCount, 0)
  })

  void it('rejects too quiet audio before provider upload', async () => {
    const provider = new FakeSttProvider('добавь задачу')
    const service = new VoiceCommandService(provider)
    const audio = Buffer.alloc(16_000 * 2)

    audio.writeInt16LE(800, 0)

    await assert.rejects(
      () =>
        service.process({
          audio: createRequestAudio(audio),
          context: {
            actorUserId: 'user-1',
            workspaceId: 'workspace-1',
          },
          security: createSecurity(),
        }),
      (error) => isVoiceCommandError(error, 'TOO_QUIET'),
    )
    assert.equal(provider.callCount, 0)
  })

  void it('validates PCM/LPCM 16 kHz mono 16-bit little-endian format', () => {
    const audio = validateCommandAudio(createVoiceAudio(900), {
      format: COMMAND_AUDIO_FORMAT,
    })

    assert.equal(audio.format.encoding, 'pcm_s16le')
    assert.equal(audio.format.sampleRateHertz, 16_000)
    assert.equal(audio.hasVoiceActivity, true)
  })

  void it('rejects duplicate request ids before provider upload', async () => {
    const provider = new FakeSttProvider('добавь задачу')
    const service = new VoiceCommandService(provider)
    const security = createSecurity()

    await service.process({
      audio: createRequestAudio(createVoiceAudio(900)),
      context: {
        actorUserId: 'user-1',
        deviceId: 'device-1',
        workspaceId: 'workspace-1',
      },
      security,
    })

    await assert.rejects(
      () =>
        service.process({
          audio: createRequestAudio(createVoiceAudio(900)),
          context: {
            actorUserId: 'user-1',
            deviceId: 'device-1',
            workspaceId: 'workspace-1',
          },
          security,
        }),
      (error) => isVoiceCommandError(error, 'REPLAY_REJECTED'),
    )
    assert.equal(provider.callCount, 1)
  })

  void it('rejects expired and too-far-future request timestamps', async () => {
    const provider = new FakeSttProvider('добавь задачу')
    const service = new VoiceCommandService(provider)

    await assert.rejects(
      () =>
        service.process({
          audio: createRequestAudio(createVoiceAudio(900)),
          context: {
            actorUserId: 'user-1',
            deviceId: 'device-1',
            workspaceId: 'workspace-1',
          },
          security: createSecurity({
            issuedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
          }),
        }),
      (error) => isVoiceCommandError(error, 'REPLAY_REJECTED'),
    )

    await assert.rejects(
      () =>
        service.process({
          audio: createRequestAudio(createVoiceAudio(900)),
          context: {
            actorUserId: 'user-1',
            deviceId: 'device-1',
            workspaceId: 'workspace-1',
          },
          security: createSecurity({
            issuedAt: new Date(Date.now() + 2 * 60_000).toISOString(),
          }),
        }),
      (error) => isVoiceCommandError(error, 'REPLAY_REJECTED'),
    )

    await service.process({
      audio: createRequestAudio(createVoiceAudio(900)),
      context: {
        actorUserId: 'user-1',
        deviceId: 'device-1',
        workspaceId: 'workspace-1',
      },
      security: createSecurity({
        issuedAt: new Date(Date.now() + 30_000).toISOString(),
      }),
    })

    assert.equal(provider.callCount, 1)
  })

  void it('rejects duplicate request ids after failed attempts', async () => {
    const provider = new FakeSttProvider('')
    const service = new VoiceCommandService(provider)
    const security = createSecurity()

    await assert.rejects(
      () =>
        service.process({
          audio: createRequestAudio(createVoiceAudio(900)),
          context: {
            actorUserId: 'user-1',
            deviceId: 'device-1',
            workspaceId: 'workspace-1',
          },
          security,
        }),
      (error) => isVoiceCommandError(error, 'NO_SPEECH'),
    )

    await assert.rejects(
      () =>
        service.process({
          audio: createRequestAudio(createVoiceAudio(900)),
          context: {
            actorUserId: 'user-1',
            deviceId: 'device-1',
            workspaceId: 'workspace-1',
          },
          security,
        }),
      (error) => isVoiceCommandError(error, 'REPLAY_REJECTED'),
    )
    assert.equal(provider.callCount, 1)
  })

  void it('rate limits by user, device, and IP fallback', async () => {
    const provider = new FakeSttProvider('добавь задачу')
    const service = new VoiceCommandService(provider)

    for (let index = 0; index < 30; index += 1) {
      await service.process({
        audio: createRequestAudio(createVoiceAudio(900)),
        context: {
          actorUserId: 'user-1',
          deviceId: 'device-1',
          ipAddress: '127.0.0.1',
          workspaceId: 'workspace-1',
        },
        security: createSecurity(),
      })
    }

    await assert.rejects(
      () =>
        service.process({
          audio: createRequestAudio(createVoiceAudio(900)),
          context: {
            actorUserId: 'user-1',
            deviceId: 'device-1',
            ipAddress: '127.0.0.1',
            workspaceId: 'workspace-1',
          },
          security: createSecurity(),
        }),
      (error) => isVoiceCommandError(error, 'RATE_LIMITED'),
    )

    await service.process({
      audio: createRequestAudio(createVoiceAudio(900)),
      context: {
        actorUserId: 'user-1',
        deviceId: 'device-2',
        ipAddress: '127.0.0.1',
        workspaceId: 'workspace-1',
      },
      security: createSecurity(),
    })

    const fallbackService = new VoiceCommandService(provider)

    for (let index = 0; index < 30; index += 1) {
      await fallbackService.process({
        audio: createRequestAudio(createVoiceAudio(900)),
        context: {
          actorUserId: 'user-2',
          ipAddress: '127.0.0.2',
          workspaceId: 'workspace-1',
        },
        security: createSecurity(),
      })
    }

    await assert.rejects(
      () =>
        fallbackService.process({
          audio: createRequestAudio(createVoiceAudio(900)),
          context: {
            actorUserId: 'user-2',
            ipAddress: '127.0.0.2',
            workspaceId: 'workspace-1',
          },
          security: createSecurity(),
        }),
      (error) => isVoiceCommandError(error, 'RATE_LIMITED'),
    )

    await fallbackService.process({
      audio: createRequestAudio(createVoiceAudio(900)),
      context: {
        actorUserId: 'user-2',
        ipAddress: '127.0.0.3',
        workspaceId: 'workspace-1',
      },
      security: createSecurity(),
    })
  })

  void it('records audit-safe metrics without transcript, titles, or audio', async () => {
    const provider = new FakeSttProvider('добавь задачу секретная задача')
    const metrics = new FakeMetricsSink()
    const service = new VoiceCommandService(provider, metrics)

    await service.process({
      audio: createRequestAudio(createVoiceAudio(900)),
      context: {
        actorUserId: 'user-1',
        deviceId: 'device-1',
        ipAddress: '127.0.0.1',
        workspaceId: 'workspace-1',
      },
      security: createSecurity(),
      source: 'android_push_to_talk',
    })

    const serialized = JSON.stringify(metrics.events)

    assert.match(serialized, /workspaceIdHash/)
    assert.doesNotMatch(serialized, /workspace-1/)
    assert.doesNotMatch(serialized, /секретная задача/)
    assert.doesNotMatch(serialized, /transcript/)
    assert.doesNotMatch(serialized, /rawAudio/)
    assert.ok(
      metrics.events.some((event) => event.event === 'voice_command_received'),
    )
  })

  void it('recursively redacts unsafe nested audit payloads', () => {
    const metrics = new FakeMetricsSink()
    const service = new VoiceCommandService(
      new FakeSttProvider('добавь задачу'),
      metrics,
    )

    service.recordAuditEvent('voice_action_preview_created', {
      agendaItems: [{ title: 'встреча с юристом' }],
      audio: new Uint8Array([1, 2, 3]),
      errorCode: 'requires_unlock',
      intent: {
        intent: 'reschedule_task',
        rawText: 'перенеси секретный договор',
        targetQuery: 'секретный договор',
      },
      metadata: {
        fullTranscript: 'добавь личные лекарства',
        nested: {
          shoppingItemName: 'личные лекарства',
          taskTitle: 'секретный договор',
        },
        safeCode: 'locked_screen',
      },
      preview: {
        candidates: [{ title: 'секретный договор' }],
        summary: 'Разблокируй телефон, чтобы продолжить.',
        title: 'Нужна разблокировка',
      },
      previewStatus: 'requires_unlock',
      taskTitles: ['секретный договор'],
      transcript: 'перенеси секретный договор',
    })

    const serialized = JSON.stringify(metrics.events)

    assert.match(serialized, /voice_action_preview_created/)
    assert.match(serialized, /previewStatus/)
    assert.match(serialized, /requires_unlock/)
    assert.match(serialized, /safeCode/)
    assert.doesNotMatch(serialized, /секрет/)
    assert.doesNotMatch(serialized, /личные лекарства/)
    assert.doesNotMatch(serialized, /юрист/)
    assert.doesNotMatch(serialized, /transcript/i)
    assert.doesNotMatch(serialized, /agendaItems/)
    assert.doesNotMatch(serialized, /candidates/)
    assert.doesNotMatch(serialized, /rawText/)
    assert.doesNotMatch(serialized, /taskTitle/)
  })
})

class FakeSttProvider implements BackendSttProvider {
  callCount = 0

  constructor(
    private readonly transcript: string,
    private readonly available = true,
  ) {}

  isAvailable(): boolean {
    return this.available
  }

  transcribe(
    _input: BackendSttProviderInput,
  ): Promise<BackendSttProviderResult> {
    this.callCount += 1

    return Promise.resolve({
      confidence: null,
      provider: 'backend_yandex_speechkit',
      transcript: this.transcript,
    })
  }
}

class FakePlannerIntentFallback implements BackendPlannerIntentFallback {
  callCount = 0
  lastInput:
    Parameters<BackendPlannerIntentFallback['parseText']>[0] | undefined

  constructor(private readonly output: unknown) {}

  parseText(
    input: Parameters<BackendPlannerIntentFallback['parseText']>[0],
  ): Promise<unknown> {
    this.callCount += 1
    this.lastInput = input

    return Promise.resolve(this.output)
  }
}

class FakeMetricsSink {
  readonly events: Array<{
    details?: Record<string, unknown>
    event: string
  }> = []

  record(event: string, details?: Record<string, unknown>): void {
    this.events.push(details ? { details, event } : { event })
  }
}

function createRequestAudio(data: Buffer) {
  return {
    data,
    metadata: {
      format: COMMAND_AUDIO_FORMAT,
    },
  }
}

function createSecurity(
  overrides: Partial<{
    issuedAt: string
    requestId: string
    sessionId: string
  }> = {},
) {
  return {
    issuedAt: new Date().toISOString(),
    requestId: randomUUID(),
    sessionId: 'voice-session-1',
    ...overrides,
  }
}

function createVoiceAudio(durationMs: number): Buffer {
  const sampleCount = Math.round((16_000 * durationMs) / 1000)
  const audio = Buffer.alloc(sampleCount * 2)

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin(index / 7) * 2800)
    audio.writeInt16LE(sample, index * 2)
  }

  return audio
}

function isVoiceCommandError(
  error: unknown,
  code: VoiceCommandError['sttError'],
): boolean {
  return error instanceof VoiceCommandError && error.sttError === code
}
