import { describe, expect, it } from 'vitest'

import {
  appendVoiceTranscript,
  canAppendToVoiceSession,
  createVoiceAppendSession,
  shouldResetAppendOnVoiceStart,
  VOICE_APPEND_WINDOW_MS,
} from './voice-append-session'

describe('voice append session', () => {
  it('appends a follow-up transcript to the last phrase and extends the window', () => {
    const session = createVoiceAppendSession({
      nowMs: 1_000,
      source: 'android_wake_word',
      transcript: 'купить молоко',
    })

    const result = appendVoiceTranscript({
      addition: 'и хлеб',
      nowMs: 2_000,
      session,
    })

    expect(result).toMatchObject({
      appendCount: 1,
      appended: true,
      transcript: 'купить молоко и хлеб',
    })
    expect(result.appended && result.session.expiresAtMs).toBe(
      2_000 + VOICE_APPEND_WINDOW_MS,
    )
  })

  it('does not append after the append window expires', () => {
    const session = createVoiceAppendSession({
      nowMs: 1_000,
      source: 'web_microphone',
      transcript: 'создай задачу отчет',
    })

    expect(
      canAppendToVoiceSession(session, 1_000 + VOICE_APPEND_WINDOW_MS + 1),
    ).toBe(false)
    expect(
      appendVoiceTranscript({
        addition: 'завтра',
        nowMs: 1_000 + VOICE_APPEND_WINDOW_MS + 1,
        session,
      }),
    ).toEqual({
      appended: false,
      transcript: 'завтра',
    })
  })

  it('resets append on a new wake session unless append was explicitly requested', () => {
    expect(
      shouldResetAppendOnVoiceStart({
        appendRequested: false,
        source: 'android_wake_word',
      }),
    ).toBe(true)
    expect(
      shouldResetAppendOnVoiceStart({
        appendRequested: true,
        source: 'android_microphone',
      }),
    ).toBe(false)
  })
})
