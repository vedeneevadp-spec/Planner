import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PushNotificationsApiClient } from './push-notifications-api'

type PushListener = (payload: never) => void

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  appGetInfo: vi.fn(),
  checkPermissions: vi.fn(),
  createChannel: vi.fn(),
  createPushNotificationsApiClient: vi.fn(),
  getPlatform: vi.fn(),
  isNativePlatform: vi.fn(),
  preferencesGet: vi.fn(),
  preferencesRemove: vi.fn(),
  preferencesSet: vi.fn(),
  register: vi.fn(),
  removeListener: vi.fn(),
  requestPermissions: vi.fn(),
}))

vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: mocks.appGetInfo,
  },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: mocks.getPlatform,
    isNativePlatform: mocks.isNativePlatform,
  },
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: mocks.preferencesGet,
    remove: mocks.preferencesRemove,
    set: mocks.preferencesSet,
  },
}))

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: mocks.addListener,
    checkPermissions: mocks.checkPermissions,
    createChannel: mocks.createChannel,
    register: mocks.register,
    requestPermissions: mocks.requestPermissions,
  },
}))

vi.mock('./push-notifications-api', () => ({
  createPushNotificationsApiClient: mocks.createPushNotificationsApiClient,
}))

import {
  isAndroidPushNotificationsRuntime,
  registerNativePushNotifications,
  unregisterStoredNativePushDevice,
} from './native-push-notifications'

describe('native push notifications', () => {
  beforeEach(() => {
    mocks.isNativePlatform.mockReturnValue(true)
    mocks.getPlatform.mockReturnValue('android')
    mocks.addListener.mockResolvedValue({
      remove: mocks.removeListener,
    })
    mocks.checkPermissions.mockResolvedValue({ receive: 'granted' })
    mocks.createChannel.mockResolvedValue(undefined)
    mocks.preferencesGet.mockResolvedValue({ value: 'installation-1' })
    mocks.preferencesRemove.mockResolvedValue(undefined)
    mocks.preferencesSet.mockResolvedValue(undefined)
    mocks.register.mockResolvedValue(undefined)
    mocks.requestPermissions.mockResolvedValue({ receive: 'granted' })
    mocks.appGetInfo.mockResolvedValue({ version: '1.2.3' })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('detects only the Android native runtime', () => {
    expect(isAndroidPushNotificationsRuntime()).toBe(true)

    mocks.getPlatform.mockReturnValue('ios')

    expect(isAndroidPushNotificationsRuntime()).toBe(false)

    mocks.isNativePlatform.mockReturnValue(false)

    expect(isAndroidPushNotificationsRuntime()).toBe(false)
  })

  it('registers Android push listeners and stores the device context', async () => {
    const listeners = new Map<string, PushListener>()
    const apiClient = createPushApiClient()
    mocks.addListener.mockImplementation(
      (
        event: string,
        listener: PushListener,
      ): Promise<{ remove: () => Promise<void> }> => {
        listeners.set(event, listener)

        return Promise.resolve({
          remove: () => {
            mocks.removeListener()

            return Promise.resolve()
          },
        })
      },
    )

    const cleanup = await registerNativePushNotifications({
      actorUserId: 'user-1',
      apiClient,
      workspaceId: 'workspace-1',
    })

    expect(mocks.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'chaotika-general',
        name: 'Chaotika',
      }),
    )
    expect(mocks.register).toHaveBeenCalled()

    listeners.get('registration')?.({ value: 'push-token-1' } as never)

    await waitFor(() => {
      expect(apiClient.upsertDevice).toHaveBeenCalled()
    })

    const [upsertInput] = vi.mocked(apiClient.upsertDevice).mock.calls[0]!

    expect(upsertInput).toMatchObject({
      appVersion: '1.2.3',
      installationId: 'installation-1',
      platform: 'android',
      token: 'push-token-1',
    })
    expect(upsertInput.locale).toEqual(expect.any(String))
    expect(mocks.preferencesSet).toHaveBeenCalledWith({
      key: 'planner.push.registration-context',
      value: JSON.stringify({
        actorUserId: 'user-1',
        installationId: 'installation-1',
        workspaceId: 'workspace-1',
      }),
    })

    await cleanup()

    expect(mocks.removeListener).toHaveBeenCalledTimes(4)
  })

  it('skips push registration when notification permission is denied', async () => {
    mocks.checkPermissions.mockResolvedValueOnce({ receive: 'prompt' })
    mocks.requestPermissions.mockResolvedValueOnce({ receive: 'denied' })

    const cleanup = await registerNativePushNotifications({
      actorUserId: 'user-1',
      apiClient: createPushApiClient(),
      workspaceId: 'workspace-1',
    })

    expect(mocks.register).not.toHaveBeenCalled()

    await cleanup()

    expect(mocks.removeListener).toHaveBeenCalledTimes(4)
  })

  it('unregisters a stored Android push device and clears local context', async () => {
    const apiClient = createPushApiClient()
    mocks.createPushNotificationsApiClient.mockReturnValue(apiClient)
    mocks.preferencesGet.mockResolvedValueOnce({
      value: JSON.stringify({
        actorUserId: 'stored-user',
        installationId: 'installation-1',
        workspaceId: 'workspace-1',
      }),
    })

    await unregisterStoredNativePushDevice({
      accessToken: 'access-token',
      apiBaseUrl: 'https://api.chaotika.test',
    })

    expect(mocks.createPushNotificationsApiClient).toHaveBeenCalledWith({
      accessToken: 'access-token',
      actorUserId: 'stored-user',
      apiBaseUrl: 'https://api.chaotika.test',
      workspaceId: 'workspace-1',
    })
    expect(apiClient.removeDevice).toHaveBeenCalledWith('installation-1')
    expect(mocks.preferencesRemove).toHaveBeenCalledWith({
      key: 'planner.push.registration-context',
    })
  })

  it('does not unregister push devices outside Android native runtime', async () => {
    mocks.isNativePlatform.mockReturnValue(false)

    await unregisterStoredNativePushDevice({
      accessToken: 'access-token',
      apiBaseUrl: 'https://api.chaotika.test',
    })

    expect(mocks.preferencesGet).not.toHaveBeenCalled()
    expect(mocks.createPushNotificationsApiClient).not.toHaveBeenCalled()
  })
})

function createPushApiClient(): PushNotificationsApiClient {
  return {
    removeDevice: vi.fn(() => Promise.resolve()),
    sendTestNotification: vi.fn(() =>
      Promise.resolve({
        deliveredCount: 1,
        failedCount: 0,
        invalidTokenCount: 0,
      }),
    ),
    upsertDevice: vi.fn(() =>
      Promise.resolve({
        appVersion: '1.2.3',
        createdAt: '2026-06-28T10:00:00.000Z',
        deletedAt: null,
        deviceName: null,
        id: 'push-device-1',
        installationId: 'installation-1',
        lastRegisteredAt: '2026-06-28T10:00:00.000Z',
        locale: 'ru-RU',
        platform: 'android' as const,
        token: 'push-token-1',
        updatedAt: '2026-06-28T10:00:00.000Z',
        userId: 'user-1',
        version: 1,
        workspaceId: 'workspace-1',
      }),
    ),
  }
}
