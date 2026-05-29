import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type {
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
