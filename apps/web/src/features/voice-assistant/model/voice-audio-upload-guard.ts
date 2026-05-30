export type VoiceAudioUploadSource =
  | 'android_push_to_talk'
  | 'android_wake_word'
  | 'web_push_to_talk'

export type VoicePrivacyBlockReason =
  | 'explicit_user_action_required'
  | 'local_validation_failed'
  | 'no_voice_activity'
  | 'silent_audio'
  | 'too_long'
  | 'too_quiet'
  | 'too_short'
  | 'wake_word_required'

export interface VoiceAudioUploadGuardInput {
  durationMs: number
  explicitUserAction?: boolean | undefined
  hasVoiceActivity: boolean
  isSilent?: boolean | undefined
  isTooQuiet?: boolean | undefined
  localValidationPassed: boolean
  source: VoiceAudioUploadSource
  wakeWordDetected?: boolean | undefined
}

export type VoiceAudioUploadDecision =
  | { allowed: true }
  | { allowed: false; reason: VoicePrivacyBlockReason }

export const VOICE_AUDIO_UPLOAD_MIN_DURATION_MS = 500
export const VOICE_AUDIO_UPLOAD_MAX_DURATION_MS = 8_000

export function decideVoiceAudioUpload(
  input: VoiceAudioUploadGuardInput,
): VoiceAudioUploadDecision {
  if (input.source === 'android_wake_word' && !input.wakeWordDetected) {
    return { allowed: false, reason: 'wake_word_required' }
  }

  if (
    (input.source === 'android_push_to_talk' ||
      input.source === 'web_push_to_talk') &&
    !input.explicitUserAction
  ) {
    return { allowed: false, reason: 'explicit_user_action_required' }
  }

  if (!input.localValidationPassed) {
    return { allowed: false, reason: 'local_validation_failed' }
  }

  if (input.durationMs < VOICE_AUDIO_UPLOAD_MIN_DURATION_MS) {
    return { allowed: false, reason: 'too_short' }
  }

  if (input.durationMs > VOICE_AUDIO_UPLOAD_MAX_DURATION_MS) {
    return { allowed: false, reason: 'too_long' }
  }

  if (input.isSilent) {
    return { allowed: false, reason: 'silent_audio' }
  }

  if (input.isTooQuiet) {
    return { allowed: false, reason: 'too_quiet' }
  }

  if (!input.hasVoiceActivity) {
    return { allowed: false, reason: 'no_voice_activity' }
  }

  return { allowed: true }
}
