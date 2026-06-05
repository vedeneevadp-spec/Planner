import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readClientEvents } from '@/shared/lib/observability'

import type { VoiceAssistantNativeStatus } from '../lib/native-voice-assistant'
import {
  analyzePcm16Audio,
  WEB_VOICE_PERMISSION_READY_MESSAGE,
  type WebVoiceRecording,
} from '../model/web-voice-input'
import { VoiceAssistant } from './VoiceAssistant'

interface FakeRecorder {
  cancel: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn<() => Promise<WebVoiceRecording>>>
}

interface PlannerHookStub {
  addTask: ReturnType<typeof vi.fn>
  refresh: () => Promise<void>
  removeTask: ReturnType<typeof vi.fn>
  setTaskSchedule: ReturnType<typeof vi.fn>
  spheres: Array<{ id: string; name: string }>
  tasks: unknown[]
}

interface SessionFeatureReadinessStub {
  apiConfig: {
    actorUserId: string
    apiBaseUrl: string
    workspaceId: string
  }
  session: {
    actorUserId: string
    appRole: 'owner'
    userPreferences: {
      voiceAssistantEnabled: boolean
    }
    workspaceId: string
    workspaceSettings: {
      wakeWordTrainingModeEnabled: boolean
    }
  }
}

interface ShoppingMutationStub {
  mutateAsync: ReturnType<typeof vi.fn>
}

interface VoiceCommandResponseStub {
  intent: {
    confidence: number
    intent: 'create_task'
    needsConfirmation: boolean
    rawText: string
    title: string
  }
  stt: {
    billableSecondsEstimated: number
    confidence: null
    durationMs: number
    provider: 'backend_yandex_speechkit'
    source: 'web_push_to_talk'
    transcript: string
  }
  transcript: string
}

interface NativeVoiceCommandStub {
  capturedAt: string
  errorCode?: string | null
  errorMessage?: string | null
  id: string
  intent?: VoiceCommandResponseStub['intent'] | null
  source?: 'ANDROID_PUSH_TO_TALK' | 'ANDROID_SHORT_CLIP' | null
  transcript?: string | null
}

const mocks = vi.hoisted(() => ({
  captureAndroidVoiceCommand: vi.fn<(...args: unknown[]) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  consumePendingAndroidVoiceCommand: vi.fn<
    () => Promise<NativeVoiceCommandStub | null>
  >(() => Promise.resolve(null)),
  getVoiceAssistantNativeStatus: vi.fn<
    () => Promise<VoiceAssistantNativeStatus | null>
  >(() => Promise.resolve(null)),
  isAndroidVoiceAssistantRuntime: vi.fn(() => false),
  notifyAndroidVoiceActionResult: vi.fn(() => Promise.resolve()),
  stopAndroidVoiceAssistant: vi.fn(() => Promise.resolve()),
  startWebVoiceRecorder: vi.fn<() => Promise<FakeRecorder>>(),
  uploadWebVoiceCommand:
    vi.fn<(...args: unknown[]) => Promise<VoiceCommandResponseStub>>(),
  useCreateShoppingListItem: vi.fn<() => ShoppingMutationStub>(() => ({
    mutateAsync: vi.fn(),
  })),
  usePlanner: vi.fn<() => PlannerHookStub>(),
  usePlannerApiClient: vi.fn(() => null),
  useRemoveShoppingListItem: vi.fn<() => ShoppingMutationStub>(() => ({
    mutateAsync: vi.fn(),
  })),
  useShoppingListSummary: vi.fn(() => ({
    data: [],
    refetch: vi.fn(() => Promise.resolve({ data: [] })),
  })),
  useSessionFeatureReadiness: vi.fn<() => SessionFeatureReadinessStub>(),
  useUpdateShoppingListItem: vi.fn<() => ShoppingMutationStub>(() => ({
    mutateAsync: vi.fn(),
  })),
}))

vi.mock('@/features/planner', () => ({
  usePlanner: () => mocks.usePlanner(),
  usePlannerApiClient: () => mocks.usePlannerApiClient(),
}))

vi.mock('@/features/session', () => ({
  useSessionFeatureReadiness: () => mocks.useSessionFeatureReadiness(),
}))

vi.mock('@/features/shopping-list', () => ({
  useCreateShoppingListItem: () => mocks.useCreateShoppingListItem(),
  useRemoveShoppingListItem: () => mocks.useRemoveShoppingListItem(),
  useShoppingListSummary: () => mocks.useShoppingListSummary(),
  useUpdateShoppingListItem: () => mocks.useUpdateShoppingListItem(),
}))

vi.mock('../lib/native-voice-assistant', () => ({
  addAndroidVoiceAssistantResumeListener: () =>
    Promise.resolve({ remove: () => Promise.resolve() }),
  addVoiceAssistantSettingsChangedListener: () => () => {},
  captureAndroidVoiceCommand: (...args: unknown[]) =>
    mocks.captureAndroidVoiceCommand(...args),
  consumePendingAndroidVoiceCommand: () =>
    mocks.consumePendingAndroidVoiceCommand(),
  getVoiceAssistantNativeStatus: () => mocks.getVoiceAssistantNativeStatus(),
  isAndroidVoiceAssistantRuntime: () => mocks.isAndroidVoiceAssistantRuntime(),
  notifyAndroidVoiceActionResult: () => mocks.notifyAndroidVoiceActionResult(),
  startAndroidVoiceAssistant: vi.fn(() => Promise.resolve()),
  stopAndroidVoiceAssistant: () => mocks.stopAndroidVoiceAssistant(),
}))

vi.mock('../lib/web-voice-recorder', () => ({
  startWebVoiceRecorder: () => mocks.startWebVoiceRecorder(),
}))

vi.mock('../lib/web-voice-command-api', () => ({
  WebVoiceCommandApiError: class WebVoiceCommandApiError extends Error {
    readonly code = 'voice_command_failed'
    readonly status = 500
  },
  uploadWebVoiceCommand: (...args: unknown[]) =>
    mocks.uploadWebVoiceCommand(...args),
}))

describe('VoiceAssistant web push-to-talk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.__CHAOTIKA_DIAGNOSTICS__?.clear()
    stubWebVoiceSupport()
    mocks.captureAndroidVoiceCommand.mockResolvedValue(undefined)
    mocks.consumePendingAndroidVoiceCommand.mockResolvedValue(null)
    mocks.getVoiceAssistantNativeStatus.mockResolvedValue(null)
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(false)
    mocks.stopAndroidVoiceAssistant.mockResolvedValue(undefined)
    mocks.usePlanner.mockReturnValue({
      addTask: vi.fn(),
      refresh: vi.fn(() => Promise.resolve()),
      removeTask: vi.fn(),
      setTaskSchedule: vi.fn(),
      spheres: [],
      tasks: [],
    })
    mocks.useSessionFeatureReadiness.mockReturnValue({
      apiConfig: {
        actorUserId: 'user-1',
        apiBaseUrl: 'https://chaotika.test',
        workspaceId: 'workspace-1',
      },
      session: {
        actorUserId: 'user-1',
        appRole: 'owner',
        userPreferences: {
          voiceAssistantEnabled: true,
        },
        workspaceId: 'workspace-1',
        workspaceSettings: {
          wakeWordTrainingModeEnabled: false,
        },
      },
    })
    mocks.startWebVoiceRecorder.mockResolvedValue(createRecorder(900))
    mocks.uploadWebVoiceCommand.mockResolvedValue(createVoiceResponse())
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows unsupported browser fallback without blocking manual input', async () => {
    vi.stubGlobal('MediaRecorder', undefined)

    render(
      <>
        <input aria-label="Ручной ввод задачи" />
        <VoiceAssistant />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))

    expect(
      (await screen.findAllByText(/Голосовой ввод недоступен в этом браузере/))
        .length,
    ).toBeGreaterThan(0)
    expect(screen.getByLabelText('Ручной ввод задачи')).toBeEnabled()
    expect(mocks.startWebVoiceRecorder).not.toHaveBeenCalled()
  })

  it('shows insecure context as a visual error', async () => {
    stubSecureContext(false)

    render(<VoiceAssistant />)

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))

    expect(
      await screen.findByText('Открой приложение через HTTPS или localhost.'),
    ).toBeVisible()
  })

  it('shows permission denied errors', async () => {
    mocks.startWebVoiceRecorder.mockRejectedValue({ name: 'NotAllowedError' })

    render(<VoiceAssistant />)

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))

    expect(await screen.findByText('Нет доступа к микрофону.')).toBeVisible()
  })

  it('updates the denied card when browser microphone permission becomes granted', async () => {
    const microphonePermission = stubMicrophonePermissionState('denied')

    mocks.startWebVoiceRecorder.mockRejectedValue({ name: 'NotAllowedError' })

    render(<VoiceAssistant />)

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))

    expect(await screen.findByText('Нет доступа к микрофону.')).toBeVisible()

    await waitFor(() => {
      expect(microphonePermission.addEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function),
      )
    })

    act(() => {
      microphonePermission.setState('granted')
    })

    expect(
      await screen.findByText(WEB_VOICE_PERMISSION_READY_MESSAGE),
    ).toBeVisible()
    expect(screen.getByText('Доступ к микрофону разрешен')).toBeVisible()
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeVisible()
  })

  it('shows microphone not found errors', async () => {
    mocks.startWebVoiceRecorder.mockRejectedValue({ name: 'NotFoundError' })

    render(<VoiceAssistant />)

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))

    expect(await screen.findByText('Микрофон не найден.')).toBeVisible()
  })

  it('does not upload too short audio and allows retry or manual input', async () => {
    mocks.startWebVoiceRecorder.mockResolvedValue(createRecorder(400))

    render(<VoiceAssistant />)

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить' }))

    expect(await screen.findByText('Нужно повторить')).toBeVisible()
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Ввести вручную' })).toBeVisible()
    expect(mocks.uploadWebVoiceCommand).not.toHaveBeenCalled()
  })

  it('starts recording only after explicit mic click', async () => {
    render(<VoiceAssistant />)

    expect(mocks.startWebVoiceRecorder).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))

    expect((await screen.findAllByText('Слушаю'))[0]).toBeVisible()
    expect(mocks.startWebVoiceRecorder).toHaveBeenCalledTimes(1)
  })

  it('shows the confirmation card after backend transcript and PlannerIntent response', async () => {
    render(<VoiceAssistant />)

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить' }))

    expect(
      await screen.findByRole('dialog', { name: 'Голосовая команда' }),
    ).toBeVisible()
    expect(await screen.findByText('Распознано')).toBeVisible()
    expect(screen.getByText('добавь задачу отчет')).toBeVisible()
    expect(screen.getByText('отчет')).toBeVisible()
    expect(mocks.uploadWebVoiceCommand).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(JSON.stringify(readClientEvents())).not.toContain(
        'добавь задачу отчет',
      )
    })
  })

  it('shows processing while a web recording stop is still resolving', async () => {
    const stopDeferred = createDeferred<WebVoiceRecording>()

    mocks.startWebVoiceRecorder.mockResolvedValue({
      cancel: vi.fn(),
      stop: vi.fn(() => stopDeferred.promise),
    })

    render(<VoiceAssistant />)

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить' }))

    expect(await screen.findByLabelText('Processing')).toBeVisible()
    expect(screen.queryByLabelText('Listening')).not.toBeInTheDocument()
    expect(mocks.uploadWebVoiceCommand).not.toHaveBeenCalled()

    act(() => {
      stopDeferred.resolve(createRecording(900))
    })

    expect(await screen.findByText('Распознано')).toBeVisible()
    expect(mocks.uploadWebVoiceCommand).toHaveBeenCalledTimes(1)
  })

  it('appends a repeated voice input to the last recognized phrase', async () => {
    mocks.uploadWebVoiceCommand
      .mockResolvedValueOnce(
        createVoiceResponse({
          title: 'купить молоко',
          transcript: 'купить молоко',
        }),
      )
      .mockResolvedValueOnce(
        createVoiceResponse({
          title: 'и хлеб',
          transcript: 'и хлеб',
        }),
      )

    render(<VoiceAssistant />)

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить' }))

    expect(
      (await screen.findAllByText('купить молоко')).length,
    ).toBeGreaterThan(0)

    fireEvent.click(await screen.findByRole('button', { name: 'Ещё сказать' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить' }))

    expect(
      (await screen.findAllByText('купить молоко и хлеб')).length,
    ).toBeGreaterThan(0)
    expect(mocks.uploadWebVoiceCommand).toHaveBeenCalledTimes(2)
  })

  it('keeps polling Android push-to-talk until the native command is ready', async () => {
    vi.useFakeTimers()
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.consumePendingAndroidVoiceCommand
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        capturedAt: '2026-06-01T00:00:00.000Z',
        id: 'voice-1',
        source: 'ANDROID_PUSH_TO_TALK',
        transcript: 'добавь задачу отчет',
      })

    render(<VoiceAssistant />)

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))

    await act(async () => {})

    expect(mocks.captureAndroidVoiceCommand).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Слушаю')).toBeVisible()
    expect(screen.queryByText('Нажми микрофон')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(650)
    })

    expect(mocks.consumePendingAndroidVoiceCommand).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(mocks.consumePendingAndroidVoiceCommand).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Распознано')).toBeVisible()
    expect(screen.getByText('добавь задачу отчет')).toBeVisible()
  })

  it('rejects Android push-to-talk when the API URL points to localhost', async () => {
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.useSessionFeatureReadiness.mockReturnValue({
      apiConfig: {
        actorUserId: 'user-1',
        apiBaseUrl: 'http://127.0.0.1:3001',
        workspaceId: 'workspace-1',
      },
      session: {
        actorUserId: 'user-1',
        appRole: 'owner',
        userPreferences: {
          voiceAssistantEnabled: true,
        },
        workspaceId: 'workspace-1',
        workspaceSettings: {
          wakeWordTrainingModeEnabled: false,
        },
      },
    })

    render(<VoiceAssistant />)

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))

    expect(
      await screen.findByText(/Android-приложение собрано с локальным API URL/),
    ).toBeVisible()
    expect(mocks.captureAndroidVoiceCommand).not.toHaveBeenCalled()
  })

  it('shows Android processing when native recording has stopped', async () => {
    vi.useFakeTimers()
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.consumePendingAndroidVoiceCommand.mockResolvedValue(null)
    mocks.getVoiceAssistantNativeStatus.mockResolvedValue(
      createAndroidStatus({
        runtimeStatus: 'paused_for_command',
        state: 'transcribing',
      }),
    )

    render(<VoiceAssistant />)

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))

    await act(async () => {})

    expect(screen.getByText('Слушаю')).toBeVisible()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(650)
    })

    expect(screen.getByLabelText('Processing')).toBeVisible()
    expect(screen.queryByLabelText('Listening')).not.toBeInTheDocument()
  })

  it('shows an Android push-to-talk timeout when native command never arrives', async () => {
    vi.useFakeTimers()
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.consumePendingAndroidVoiceCommand.mockResolvedValue(null)

    render(<VoiceAssistant />)

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))

    await act(async () => {})

    expect(mocks.captureAndroidVoiceCommand).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Слушаю')).toBeVisible()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_001)
    })

    expect(
      screen.getByText(/Native status недоступен, запись остановлена/),
    ).toBeVisible()
    expect(mocks.consumePendingAndroidVoiceCommand).toHaveBeenCalled()
    expect(mocks.stopAndroidVoiceAssistant).toHaveBeenCalled()
  })

  it('times out Android push-to-talk when native capture never resolves', async () => {
    vi.useFakeTimers()
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.captureAndroidVoiceCommand.mockReturnValue(new Promise(() => {}))
    mocks.consumePendingAndroidVoiceCommand.mockResolvedValue(null)

    render(<VoiceAssistant />)

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }))

    await act(async () => {})

    expect(mocks.captureAndroidVoiceCommand).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Слушаю')).toBeVisible()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_001)
    })

    expect(screen.getByLabelText('Processing')).toBeVisible()
    expect(screen.queryByLabelText('Listening')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000)
    })

    expect(
      screen.getByText(/Native status недоступен, запись остановлена/),
    ).toBeVisible()
    expect(mocks.stopAndroidVoiceAssistant).toHaveBeenCalled()
  })
})

function stubWebVoiceSupport(): void {
  stubSecureContext(true)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(),
    },
  })
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: undefined,
  })
  vi.stubGlobal(
    'MediaRecorder',
    class FakeMediaRecorder {
      static isTypeSupported() {
        return true
      }
    },
  )
  vi.stubGlobal('AudioContext', class FakeAudioContext {})
}

function createAndroidStatus(
  overrides: Partial<VoiceAssistantNativeStatus> = {},
): VoiceAssistantNativeStatus {
  return {
    backgroundWakeWordEnabled: false,
    confirmationMode: 'confirmation_first',
    foregroundServiceStatus: 'running',
    isAndroid: true,
    microphonePermission: 'granted',
    notificationPermission: 'granted',
    platform: 'android',
    pushToTalkFallbackStatus: 'available',
    recognitionLanguage: 'ru-RU',
    runtimeDurationMs: 0,
    runtimeLastError: null,
    runtimeMetrics: {},
    runtimeStatus: 'recording_command',
    state: 'recording',
    voiceCuesEnabled: true,
    wakePhrase: 'Хаотика',
    wakeWordEnabled: true,
    wakeWordModelVersion: 'haotika-livekit-test',
    wakeWordModelStatus: 'ready',
    wakeWordProvider: 'custom_onnx',
    wakeWordSensitivity: 0.99,
    ...overrides,
  }
}

function stubMicrophonePermissionState(initialState: PermissionState): {
  addEventListener: ReturnType<typeof vi.fn>
  setState: (state: PermissionState) => void
} {
  let currentState = initialState
  const listeners = new Set<EventListenerOrEventListenerObject>()
  const addEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (type === 'change' && listener) {
        listeners.add(listener)
      }
    },
  )
  const removeEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (type === 'change' && listener) {
        listeners.delete(listener)
      }
    },
  )
  const permissionStatus = {
    addEventListener,
    removeEventListener,
    get state() {
      return currentState
    },
  } as unknown as PermissionStatus

  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: {
      query: vi.fn(() => Promise.resolve(permissionStatus)),
    },
  })

  return {
    addEventListener,
    setState(state: PermissionState) {
      currentState = state
      const event = new Event('change')

      for (const listener of listeners) {
        if (typeof listener === 'function') {
          listener.call(permissionStatus, event)
        } else {
          listener.handleEvent(event)
        }
      }
    },
  }
}

function stubSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value,
  })
}

function createRecorder(durationMs: number): FakeRecorder {
  return {
    cancel: vi.fn(),
    stop: vi.fn(() => Promise.resolve(createRecording(durationMs))),
  }
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

function createVoiceResponse(
  options: { title?: string; transcript?: string } = {},
): VoiceCommandResponseStub {
  const transcript = options.transcript ?? 'добавь задачу отчет'
  const title = options.title ?? 'отчет'

  return {
    intent: {
      confidence: 0.9,
      intent: 'create_task',
      needsConfirmation: true,
      rawText: transcript,
      title,
    },
    stt: {
      billableSecondsEstimated: 1,
      confidence: null,
      durationMs: 900,
      provider: 'backend_yandex_speechkit',
      source: 'web_push_to_talk',
      transcript,
    },
    transcript,
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

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}
