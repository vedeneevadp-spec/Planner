import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanupRetiredVoiceStorage } from './cleanup-retired-voice-storage'

describe('cleanupRetiredVoiceStorage', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('removes only retired keys while preserving auth, preferences and pending changes', () => {
    const retained = {
      'planner.auth.session': '{"accessToken":"existing-token"}',
      'planner.offline.queue': '[{"id":"pending-change"}]',
      'planner.theme': 'dark',
      'planner.voiceAssistant.deviceSettings.v2': 'unrelated-future-key',
    }

    for (const storage of [localStorage, sessionStorage]) {
      for (const [key, value] of Object.entries(retained)) {
        storage.setItem(key, value)
      }
    }
    localStorage.setItem('planner.voiceAssistant.deviceSettings.v1', '{}')
    sessionStorage.setItem('planner.webVoice.sessionId.v1', 'retired-session')
    const deleteDatabase = vi.fn()
    vi.stubGlobal('indexedDB', { deleteDatabase })

    cleanupRetiredVoiceStorage()
    cleanupRetiredVoiceStorage()

    expect(
      localStorage.getItem('planner.voiceAssistant.deviceSettings.v1'),
    ).toBeNull()
    expect(sessionStorage.getItem('planner.webVoice.sessionId.v1')).toBeNull()
    for (const storage of [localStorage, sessionStorage]) {
      expect(storage.length).toBe(Object.keys(retained).length)
      for (const [key, value] of Object.entries(retained)) {
        expect(storage.getItem(key)).toBe(value)
      }
    }
    expect(deleteDatabase).not.toHaveBeenCalled()
  })

  it('works on new installations without old data', () => {
    expect(() => cleanupRetiredVoiceStorage()).not.toThrow()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('cleans session storage when local storage access is blocked', () => {
    sessionStorage.setItem('planner.webVoice.sessionId.v1', 'old-session')
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError')
    })

    expect(() => cleanupRetiredVoiceStorage()).not.toThrow()
    expect(sessionStorage.getItem('planner.webVoice.sessionId.v1')).toBeNull()
  })

  it('does not block startup when session storage access is blocked', () => {
    localStorage.setItem('planner.voiceAssistant.deviceSettings.v1', '{}')
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError')
    })

    expect(() => cleanupRetiredVoiceStorage()).not.toThrow()
    expect(
      localStorage.getItem('planner.voiceAssistant.deviceSettings.v1'),
    ).toBeNull()
  })

  it('does not require a browser window', () => {
    vi.stubGlobal('window', undefined)

    expect(() => cleanupRetiredVoiceStorage()).not.toThrow()
  })
})
