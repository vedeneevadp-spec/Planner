import { voiceCommandCorpusV1, type VoiceTestCase } from '@planner/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  analyzePcm16Audio,
  getWebVoiceSupport,
  normalizeWebVoicePermissionError,
  validateWebVoiceRecording,
  type WebVoiceRecording,
} from './web-voice-input'

describe('web voice input model', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports unsupported state outside a secure context', () => {
    stubSecureContext(false)

    expect(getWebVoiceSupport()).toEqual({
      message: 'Открой приложение через HTTPS или localhost.',
      reason: 'insecure_context',
      supported: false,
    })
  })

  it('reports unsupported state when MediaRecorder is unavailable', () => {
    stubSecureContext(true)
    stubMediaDevices()
    vi.stubGlobal('MediaRecorder', undefined)
    vi.stubGlobal('AudioContext', class FakeAudioContext {})

    expect(getWebVoiceSupport()).toMatchObject({
      reason: 'media_recorder_unavailable',
      supported: false,
    })
  })

  it('maps unsupported web-flow corpus cases to support detection', () => {
    const scenarios = [
      {
        id: 'web_flow_002',
        setup: () => {
          stubSecureContext(false)
        },
      },
      {
        id: 'web_flow_003',
        setup: () => {
          stubSecureContext(true)
          stubMediaDevicesWithoutGetUserMedia()
          vi.stubGlobal('MediaRecorder', class FakeMediaRecorder {})
          vi.stubGlobal('AudioContext', class FakeAudioContext {})
        },
      },
      {
        id: 'web_flow_004',
        setup: () => {
          stubSecureContext(true)
          stubMediaDevices()
          vi.stubGlobal('MediaRecorder', undefined)
          vi.stubGlobal('AudioContext', class FakeAudioContext {})
        },
      },
    ]

    for (const scenario of scenarios) {
      vi.unstubAllGlobals()
      scenario.setup()

      const testCase = getWebFlowCase(scenario.id)

      expect(getWebVoiceSupport(), scenario.id).toMatchObject({
        reason: testCase.expectedWebFlow?.reason,
        supported: false,
      })
    }
  })

  it.each([
    ['NotAllowedError', 'permission_denied', 'Нет доступа к микрофону.'],
    ['NotFoundError', 'error', 'Микрофон не найден.'],
    ['NotReadableError', 'error', 'Микрофон занят другим приложением.'],
    ['SecurityError', 'unsupported', 'Открой приложение через HTTPS.'],
    ['AbortError', 'error', 'Запись прервана.'],
  ] as const)('maps %s to a visual web voice error', (name, state, message) => {
    expect(normalizeWebVoicePermissionError({ name })).toEqual({
      message,
      name,
      state,
    })
  })

  it('blocks too short audio before upload', () => {
    const recording = createRecording(400)

    expect(
      validateWebVoiceRecording(recording, { explicitUserAction: true }),
    ).toMatchObject({
      ok: false,
      reason: 'too_short',
    })
  })

  it('blocks web-flow corpus validation failures before upload', () => {
    const validationCases = [
      ['web_flow_006', createRecording(400)],
      ['web_flow_007', createSilentRecording(900)],
      ['web_flow_008', createQuietRecording(900)],
    ] as const

    for (const [id, recording] of validationCases) {
      const testCase = getWebFlowCase(id)

      expect(
        validateWebVoiceRecording(recording, { explicitUserAction: true }),
        id,
      ).toMatchObject({
        ok: false,
        reason: testCase.expectedWebFlow?.reason,
      })
    }
  })

  it('blocks upload without explicit user action', () => {
    const recording = createRecording(900)

    expect(
      validateWebVoiceRecording(recording, { explicitUserAction: false }),
    ).toEqual({
      message: 'Нажми микрофон, чтобы начать голосовой ввод.',
      ok: false,
      reason: 'explicit_user_action_required',
    })
  })

  it('allows valid voice activity audio', () => {
    const recording = createRecording(900)

    expect(
      validateWebVoiceRecording(recording, { explicitUserAction: true }),
    ).toEqual({ ok: true })
  })
})

function stubSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value,
  })
}

function stubMediaDevices(): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(),
    },
  })
}

function stubMediaDevicesWithoutGetUserMedia(): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {},
  })
}

function createRecording(durationMs: number): WebVoiceRecording {
  const audio = createVoiceAudio(durationMs)

  return {
    analysis: analyzePcm16Audio(audio),
    audio,
    byteLength: audio.byteLength,
    durationMs,
  }
}

function createVoiceAudio(durationMs: number): ArrayBuffer {
  const sampleCount = Math.round((16_000 * durationMs) / 1000)
  const audio = new ArrayBuffer(sampleCount * 2)
  const view = new DataView(audio)

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin(index / 7) * 2800)
    view.setInt16(index * 2, sample, true)
  }

  return audio
}

function createSilentRecording(durationMs: number): WebVoiceRecording {
  const audio = new ArrayBuffer(Math.round((16_000 * durationMs) / 1000) * 2)

  return {
    analysis: analyzePcm16Audio(audio),
    audio,
    byteLength: audio.byteLength,
    durationMs,
  }
}

function createQuietRecording(durationMs: number): WebVoiceRecording {
  const sampleCount = Math.round((16_000 * durationMs) / 1000)
  const audio = new ArrayBuffer(sampleCount * 2)
  const view = new DataView(audio)

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = index % 1000 === 0 ? 800 : 0
    view.setInt16(index * 2, sample, true)
  }

  return {
    analysis: analyzePcm16Audio(audio),
    audio,
    byteLength: audio.byteLength,
    durationMs,
  }
}

function getWebFlowCase(id: string): VoiceTestCase {
  const testCase = voiceCommandCorpusV1.find((candidate) => candidate.id === id)

  if (!testCase) {
    throw new Error(`Missing web flow corpus case: ${id}`)
  }

  return testCase
}
