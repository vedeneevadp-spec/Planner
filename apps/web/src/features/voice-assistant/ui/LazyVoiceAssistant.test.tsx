import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface SessionFeatureReadinessStub {
  session: {
    appRole: 'owner'
    userPreferences: {
      voiceAssistantEnabled: boolean
    }
  }
}

const mocks = vi.hoisted(() => ({
  isAndroidNativeRuntime: vi.fn<() => boolean>(),
  useSessionFeatureReadiness: vi.fn<() => SessionFeatureReadinessStub>(),
}))

vi.mock('@/features/session', () => ({
  useSessionFeatureReadiness: () => mocks.useSessionFeatureReadiness(),
}))

vi.mock('@/shared/lib/native-runtime', () => ({
  isAndroidNativeRuntime: () => mocks.isAndroidNativeRuntime(),
}))

vi.mock('./VoiceAssistant', () => ({
  VoiceAssistant: () => <output data-testid="voice-assistant">mounted</output>,
}))

import { LazyVoiceAssistant } from './LazyVoiceAssistant'

describe('LazyVoiceAssistant', () => {
  beforeEach(() => {
    mocks.isAndroidNativeRuntime.mockReset()
    mocks.isAndroidNativeRuntime.mockReturnValue(false)
    mocks.useSessionFeatureReadiness.mockReset()
    mocks.useSessionFeatureReadiness.mockReturnValue({
      session: {
        appRole: 'owner',
        userPreferences: {
          voiceAssistantEnabled: true,
        },
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('defers the browser assistant until after the initial route settles', async () => {
    let deferredMountCallback: (() => void) | null = null
    const setTimeoutSpy = vi
      .spyOn(window, 'setTimeout')
      .mockImplementation((callback) => {
        deferredMountCallback = callback

        return 1 as unknown as ReturnType<typeof window.setTimeout>
      })

    render(<LazyVoiceAssistant />)

    expect(screen.queryByTestId('voice-assistant')).not.toBeInTheDocument()

    act(() => {
      deferredMountCallback?.()
    })
    setTimeoutSpy.mockRestore()

    expect(await screen.findByTestId('voice-assistant')).toBeVisible()
  })

  it('does not load the assistant when the preference is disabled', () => {
    mocks.useSessionFeatureReadiness.mockReturnValue({
      session: {
        appRole: 'owner',
        userPreferences: {
          voiceAssistantEnabled: false,
        },
      },
    })

    render(<LazyVoiceAssistant />)

    expect(screen.queryByTestId('voice-assistant')).not.toBeInTheDocument()
  })

  it('mounts immediately on Android for wake-word handling', async () => {
    mocks.isAndroidNativeRuntime.mockReturnValue(true)

    render(<LazyVoiceAssistant />)

    expect(await screen.findByTestId('voice-assistant')).toBeVisible()
  })
})
