import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationsSettingsPage } from './NotificationsSettingsPage'

type NativePermissionStatus =
  'denied' | 'granted' | 'prompt' | 'prompt-with-rationale' | 'unavailable'

interface TestNotificationInput {
  body: string
  data: Record<string, string>
  title: string
}

interface TestNotificationResponse {
  deliveredCount: number
  failedCount: number
  invalidTokenCount: number
}

interface TestPushNotificationsApiClient {
  sendTestNotification: (
    input: TestNotificationInput,
  ) => Promise<TestNotificationResponse>
}

const mocks = vi.hoisted(() => ({
  browserOffline: false,
  createPushNotificationsApiClient:
    vi.fn<(config: unknown) => TestPushNotificationsApiClient>(),
  getNativePushPermissionStatus: vi.fn<() => Promise<NativePermissionStatus>>(),
  isAndroidPushNotificationsRuntime: vi.fn<() => boolean>(),
  mutateAsync: vi.fn<(input: Record<string, boolean>) => Promise<void>>(),
  openAndroidSystemAppSettings: vi.fn<() => Promise<void>>(),
  refetchSession: vi.fn<() => Promise<void>>(),
  requestNativePushPermission: vi.fn<() => Promise<NativePermissionStatus>>(),
  sendTestNotification:
    vi.fn<
      (input: TestNotificationInput) => Promise<TestNotificationResponse>
    >(),
  session: undefined as
    | undefined
    | {
        userPreferences: {
          sharedTaskAssignedNotificationsEnabled?: boolean
          sharedTaskCreatedNotificationsEnabled?: boolean
          sharedTaskReadyForReviewNotificationsEnabled?: boolean
        }
      },
  sessionPending: false,
  updatePending: false,
  readiness: {
    canWriteProtectedData: true,
  },
  apiConfig: {
    actorUserId: 'user-1',
    apiBaseUrl: 'https://api.chaotika.test',
    clientTimeZone: 'Asia/Novosibirsk',
    workspaceId: 'workspace-1',
  },
}))

vi.mock('@/features/session', () => ({
  createPushNotificationsApiClient: (config: unknown) =>
    mocks.createPushNotificationsApiClient(config),
  usePlannerSession: () => ({
    data: mocks.session,
    isPending: mocks.sessionPending,
    refetch: mocks.refetchSession,
  }),
  useSessionFeatureReadiness: () => ({
    apiConfig: mocks.apiConfig,
    readiness: mocks.readiness,
  }),
  useUpdateUserPreferences: () => ({
    isPending: mocks.updatePending,
    mutateAsync: mocks.mutateAsync,
  }),
}))

vi.mock('@/features/session/native-push', () => ({
  getNativePushPermissionStatus: () => mocks.getNativePushPermissionStatus(),
  requestNativePushPermission: () => mocks.requestNativePushPermission(),
}))

vi.mock('@/features/voice-assistant/native', () => ({
  openAndroidSystemAppSettings: () => mocks.openAndroidSystemAppSettings(),
}))

vi.mock('@/shared/lib/native-runtime', () => ({
  isAndroidNativeRuntime: () => mocks.isAndroidPushNotificationsRuntime(),
}))

vi.mock('@/shared/lib/offline-sync', () => ({
  useBrowserOffline: () => mocks.browserOffline,
}))

describe('NotificationsSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.browserOffline = false
    mocks.isAndroidPushNotificationsRuntime.mockReturnValue(false)
    mocks.getNativePushPermissionStatus.mockResolvedValue('unavailable')
    mocks.requestNativePushPermission.mockResolvedValue('granted')
    mocks.openAndroidSystemAppSettings.mockResolvedValue(undefined)
    mocks.mutateAsync.mockResolvedValue(undefined)
    mocks.refetchSession.mockResolvedValue(undefined)
    mocks.sendTestNotification.mockResolvedValue({
      deliveredCount: 1,
      failedCount: 0,
      invalidTokenCount: 0,
    })
    mocks.createPushNotificationsApiClient.mockReturnValue({
      sendTestNotification: mocks.sendTestNotification,
    })
    mocks.session = {
      userPreferences: {},
    }
    mocks.sessionPending = false
    mocks.updatePending = false
    mocks.readiness = {
      canWriteProtectedData: true,
    }
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('enables all three account preferences by default and saves each toggle', async () => {
    render(<NotificationsSettingsPage />)

    const switches = [
      screen.getByRole('switch', {
        name: 'Новые задачи в общих пространствах',
      }),
      screen.getByRole('switch', { name: 'Задачи, назначенные мне' }),
      screen.getByRole('switch', { name: 'Задачи, готовые к проверке' }),
    ]

    for (const control of switches) {
      expect(control).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(control)
    }

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(3)
    })
    expect(mocks.mutateAsync).toHaveBeenNthCalledWith(1, {
      sharedTaskCreatedNotificationsEnabled: false,
    })
    expect(mocks.mutateAsync).toHaveBeenNthCalledWith(2, {
      sharedTaskAssignedNotificationsEnabled: false,
    })
    expect(mocks.mutateAsync).toHaveBeenNthCalledWith(3, {
      sharedTaskReadyForReviewNotificationsEnabled: false,
    })
  })

  it('renders saved disabled preferences', () => {
    mocks.session = {
      userPreferences: {
        sharedTaskAssignedNotificationsEnabled: false,
        sharedTaskCreatedNotificationsEnabled: false,
        sharedTaskReadyForReviewNotificationsEnabled: false,
      },
    }

    render(<NotificationsSettingsPage />)

    for (const control of screen.getAllByRole('switch')) {
      expect(control).toHaveAttribute('aria-checked', 'false')
    }
  })

  it('keeps account switches read-only while offline', () => {
    mocks.browserOffline = true

    render(<NotificationsSettingsPage />)

    expect(screen.getByText('Нет подключения')).toBeVisible()
    for (const control of screen.getAllByRole('switch')) {
      expect(control).toBeDisabled()
    }
  })

  it('shows Android permission and sends a test push', async () => {
    mocks.isAndroidPushNotificationsRuntime.mockReturnValue(true)
    mocks.getNativePushPermissionStatus.mockResolvedValue('granted')

    render(<NotificationsSettingsPage />)

    const testButton = await screen.findByRole('button', {
      name: 'Отправить тестовое уведомление',
    })
    fireEvent.click(testButton)

    await waitFor(() => {
      expect(mocks.sendTestNotification).toHaveBeenCalledWith({
        body: 'Уведомления Chaotika работают.',
        data: {
          path: '/notifications/settings',
          type: 'test-notification',
        },
        title: 'Тестовое уведомление',
      })
    })
    expect(
      await screen.findByText('Тестовое уведомление отправлено.'),
    ).toBeVisible()
  })

  it('requests Android permission and registers push', async () => {
    mocks.isAndroidPushNotificationsRuntime.mockReturnValue(true)
    mocks.getNativePushPermissionStatus.mockResolvedValue('prompt')

    render(<NotificationsSettingsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Разрешить' }))

    await waitFor(() => {
      expect(mocks.requestNativePushPermission).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText(/Устройство регистрируется/)).toBeVisible()
  })

  it('explains that native delivery controls are Android-only on web', () => {
    render(<NotificationsSettingsPage />)

    expect(
      screen.getByText(/доступны в приложении Chaotika для Android/),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Отправить тестовое уведомление' }),
    ).not.toBeInTheDocument()
  })
})
