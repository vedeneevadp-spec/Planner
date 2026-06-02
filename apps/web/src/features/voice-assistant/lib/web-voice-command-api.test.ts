import { describe, expect, it, vi } from 'vitest'

import {
  analyzePcm16Audio,
  type WebVoiceRecording,
} from '../model/web-voice-input'
import { uploadWebVoiceCommand } from './web-voice-command-api'

const TEST_CONFIG = {
  actorUserId: 'user-1',
  apiBaseUrl: 'http://127.0.0.1:3001',
  workspaceId: 'workspace-1',
}

describe('web voice command api', () => {
  it('uploads PCM audio to the shared voice command endpoint as web push-to-talk', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          intent: {
            confidence: 0.9,
            intent: 'create_task',
            needsConfirmation: true,
            rawText: 'добавь задачу отчет',
            title: 'отчет',
          },
          stt: {
            billableSecondsEstimated: 1,
            confidence: null,
            durationMs: 900,
            provider: 'backend_yandex_speechkit',
            source: 'web_push_to_talk',
            transcript: 'добавь задачу отчет',
          },
          transcript: 'добавь задачу отчет',
        }),
        { status: 200 },
      ),
    )

    await uploadWebVoiceCommand(createRecording(900), TEST_CONFIG, {
      fetchFn: fetchMock,
      issuedAt: '2026-05-30T05:00:00.000Z',
      requestId: '018fc513-1840-7000-8b86-0f39b49f2049',
      sessionId: 'web-voice-session-1',
      timeoutMs: 25_000,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, requestInit] = fetchMock.mock.calls[0]!
    const headers = new Headers(requestInit?.headers)
    const requestUrl =
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url

    expect(requestUrl).toBe('http://127.0.0.1:3001/api/voice/command')
    expect(requestInit?.method).toBe('POST')
    expect(requestInit?.body).toBeInstanceOf(ArrayBuffer)
    expect(headers.get('content-type')).toBe('audio/l16')
    expect(headers.get('x-stt-source')).toBe('web_push_to_talk')
    expect(headers.get('x-voice-request-id')).toBe(
      '018fc513-1840-7000-8b86-0f39b49f2049',
    )
    expect(headers.get('x-voice-session-id')).toBe('web-voice-session-1')
    expect(headers.get('x-voice-issued-at')).toBe('2026-05-30T05:00:00.000Z')
    expect(headers.get('x-workspace-id')).toBe('workspace-1')
    expect(headers.get('x-actor-user-id')).toBe('user-1')
    expect(headers.has('x-yandex-api-key')).toBe(false)
    expect(headers.has('x-openai-api-key')).toBe(false)
  })
})

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
