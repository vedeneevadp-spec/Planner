import { describe, expect, it, vi } from 'vitest'

import {
  decideVoiceAudioUpload,
  type VoiceAudioUploadGuardInput,
} from './voice-audio-upload-guard'

describe('VoiceAudioUploadGuard', () => {
  it('blocks wake-word mode before WakeWordDetected', () => {
    const upload = vi.fn()

    uploadIfAllowed({
      source: 'android_wake_word',
      wakeWordDetected: false,
    })

    expect(upload).not.toHaveBeenCalled()

    function uploadIfAllowed(
      overrides: Partial<VoiceAudioUploadGuardInput> = {},
    ) {
      const decision = decideVoiceAudioUpload(createInput(overrides))

      if (decision.allowed) {
        upload()
      }
    }
  })

  it('blocks false wake words, missing models, revoked permission, and local validation failures', () => {
    expect(
      decideVoiceAudioUpload(
        createInput({
          localValidationPassed: false,
          source: 'android_wake_word',
          wakeWordDetected: true,
        }),
      ),
    ).toEqual({ allowed: false, reason: 'local_validation_failed' })
    expect(
      decideVoiceAudioUpload(
        createInput({
          source: 'android_wake_word',
          wakeWordDetected: false,
        }),
      ),
    ).toEqual({ allowed: false, reason: 'wake_word_required' })
  })

  it('allows wake-word upload only after wake word and local audio validation', () => {
    expect(
      decideVoiceAudioUpload(
        createInput({
          source: 'android_wake_word',
          wakeWordDetected: true,
        }),
      ),
    ).toEqual({ allowed: true })
  })

  it.each(['android_push_to_talk', 'web_push_to_talk'] as const)(
    'blocks %s upload without explicit user action',
    (source) => {
      const upload = vi.fn()
      const decision = decideVoiceAudioUpload(
        createInput({ explicitUserAction: false, source }),
      )

      if (decision.allowed) {
        upload()
      }

      expect(decision).toEqual({
        allowed: false,
        reason: 'explicit_user_action_required',
      })
      expect(upload).not.toHaveBeenCalled()
    },
  )

  it.each([
    [{ durationMs: 400 }, 'too_short'],
    [{ durationMs: 15_500 }, 'too_long'],
    [{ isSilent: true }, 'silent_audio'],
    [{ isTooQuiet: true }, 'too_quiet'],
    [{ hasVoiceActivity: false }, 'no_voice_activity'],
  ] as const)('blocks invalid command audio: %s', (overrides, reason) => {
    expect(decideVoiceAudioUpload(createInput(overrides))).toEqual({
      allowed: false,
      reason,
    })
  })
})

function createInput(
  overrides: Partial<VoiceAudioUploadGuardInput> = {},
): VoiceAudioUploadGuardInput {
  return {
    durationMs: 900,
    explicitUserAction: true,
    hasVoiceActivity: true,
    localValidationPassed: true,
    source: 'android_push_to_talk',
    wakeWordDetected: true,
    ...overrides,
  }
}
