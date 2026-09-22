// Compatibility cleanup for installations that used the retired built-in input.
// Keep exact keys: auth, preferences and offline data share these storage areas.
export function cleanupRetiredVoiceStorage(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem('planner.voiceAssistant.deviceSettings.v1')
  } catch {
    // Restricted storage must not prevent the app from starting.
  }

  try {
    window.sessionStorage.removeItem('planner.webVoice.sessionId.v1')
  } catch {
    // Attempt each storage independently; retry automatically on next startup.
  }
}
