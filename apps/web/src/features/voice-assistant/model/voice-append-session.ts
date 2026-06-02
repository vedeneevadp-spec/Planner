import type { VoiceAssistantSource } from '@planner/contracts'

export const VOICE_APPEND_WINDOW_MS = 10_000

export interface VoiceAppendSession {
  appendCount: number
  baseTranscript: string
  expiresAtMs: number
  source: VoiceAssistantSource
}

export function createVoiceAppendSession(input: {
  appendCount?: number | undefined
  nowMs: number
  source: VoiceAssistantSource
  transcript: string
}): VoiceAppendSession | null {
  const baseTranscript = normalizeVoiceAppendTranscript(input.transcript)

  if (!baseTranscript) {
    return null
  }

  return {
    appendCount: Math.max(0, input.appendCount ?? 0),
    baseTranscript,
    expiresAtMs: input.nowMs + VOICE_APPEND_WINDOW_MS,
    source: input.source,
  }
}

export function canAppendToVoiceSession(
  session: VoiceAppendSession | null,
  nowMs: number,
): session is VoiceAppendSession {
  return Boolean(
    session && session.baseTranscript && nowMs <= session.expiresAtMs,
  )
}

export function appendVoiceTranscript(input: {
  addition: string
  nowMs: number
  session: VoiceAppendSession | null
}):
  | {
      appendCount: number
      appended: true
      session: VoiceAppendSession
      transcript: string
    }
  | {
      appended: false
      transcript: string
    } {
  const addition = normalizeVoiceAppendTranscript(input.addition)

  if (!addition) {
    return {
      appended: false,
      transcript: '',
    }
  }

  if (!canAppendToVoiceSession(input.session, input.nowMs)) {
    return {
      appended: false,
      transcript: addition,
    }
  }

  const transcript = joinVoiceTranscripts(
    input.session.baseTranscript,
    addition,
  )
  const appendCount = input.session.appendCount + 1

  return {
    appendCount,
    appended: true,
    session: {
      ...input.session,
      appendCount,
      baseTranscript: transcript,
      expiresAtMs: input.nowMs + VOICE_APPEND_WINDOW_MS,
    },
    transcript,
  }
}

export function shouldResetAppendOnVoiceStart(input: {
  appendRequested: boolean
  source: VoiceAssistantSource
}): boolean {
  return !input.appendRequested || input.source === 'android_wake_word'
}

function joinVoiceTranscripts(base: string, addition: string): string {
  return normalizeVoiceAppendTranscript(`${base} ${addition}`)
}

function normalizeVoiceAppendTranscript(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}
