import assert from 'node:assert/strict'
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
      source: 'android_push_to_talk',
    })

    assert.equal(result.stt.source, 'android_push_to_talk')
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
    | Parameters<BackendPlannerIntentFallback['parseText']>[0]
    | undefined

  constructor(private readonly output: unknown) {}

  parseText(
    input: Parameters<BackendPlannerIntentFallback['parseText']>[0],
  ): Promise<unknown> {
    this.callCount += 1
    this.lastInput = input

    return Promise.resolve(this.output)
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
