import { beforeEach, describe, expect, it, vi } from 'vitest'

const capacitorMocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  commitRefresh: vi.fn(),
  durableGet: vi.fn(),
  durableRemove: vi.fn(),
  durableSet: vi.fn(),
  getPlatform: vi.fn(),
  getState: vi.fn(),
  isNativePlatform: vi.fn(),
  prepareRefresh: vi.fn(),
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: capacitorMocks.addListener,
    getState: capacitorMocks.getState,
  },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: capacitorMocks.getPlatform,
    isNativePlatform: capacitorMocks.isNativePlatform,
  },
  registerPlugin: () => ({
    commitRefresh: capacitorMocks.commitRefresh,
    get: capacitorMocks.durableGet,
    prepareRefresh: capacitorMocks.prepareRefresh,
    remove: capacitorMocks.durableRemove,
    set: capacitorMocks.durableSet,
  }),
}))

import {
  addNativeAppStateChangeListener,
  clearNativeSessionStorage,
  commitNativeAuthSessionRefresh,
  createNativeSessionStorage,
  getNativeAppIsActive,
  getNativeAuthDeviceId,
  isNativeSessionPersistenceRuntime,
  prepareNativeAuthSessionRefresh,
} from './native-session-storage'

describe('native session storage', () => {
  beforeEach(() => {
    capacitorMocks.addListener.mockReset()
    capacitorMocks.commitRefresh.mockReset()
    capacitorMocks.durableGet.mockReset()
    capacitorMocks.durableRemove.mockReset()
    capacitorMocks.durableRemove.mockResolvedValue(undefined)
    capacitorMocks.durableSet.mockReset()
    capacitorMocks.durableSet.mockResolvedValue(undefined)
    capacitorMocks.getPlatform.mockReset()
    capacitorMocks.getPlatform.mockReturnValue('android')
    capacitorMocks.getState.mockReset()
    capacitorMocks.isNativePlatform.mockReset()
    capacitorMocks.isNativePlatform.mockReturnValue(true)
    capacitorMocks.prepareRefresh.mockReset()
  })

  it('detects native runtime through Capacitor', () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true)

    expect(isNativeSessionPersistenceRuntime()).toBe(true)
  })

  it('returns no auth device id outside native runtime', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(false)

    await expect(getNativeAuthDeviceId()).resolves.toBeNull()
    expect(capacitorMocks.durableGet).not.toHaveBeenCalled()
  })

  it('reuses a stored native auth device id', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true)
    capacitorMocks.durableGet.mockResolvedValue({ value: 'native-device-1' })

    await expect(getNativeAuthDeviceId()).resolves.toBe('native-device-1')
    expect(capacitorMocks.durableGet).toHaveBeenCalledWith({
      key: 'planner.auth.deviceId',
    })
    expect(capacitorMocks.durableSet).not.toHaveBeenCalled()
  })

  it('creates and stores a native auth device id when none exists', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true)
    capacitorMocks.durableGet.mockResolvedValue({ value: null })

    const deviceId = await getNativeAuthDeviceId()

    expect(deviceId).toMatch(/^native-/)
    expect(capacitorMocks.durableSet).toHaveBeenCalledWith({
      key: 'planner.auth.deviceId',
      value: deviceId,
    })
  })

  it('reads and commits auth values through the native secure-storage bridge', async () => {
    const storage = createNativeSessionStorage()
    capacitorMocks.durableGet.mockResolvedValue({ value: 'stored-session' })

    await expect(storage.getItem('sb-test-auth-token')).resolves.toBe(
      'stored-session',
    )
    await storage.setItem('sb-test-auth-token', 'fresh-session')
    await storage.removeItem('sb-test-auth-token')

    expect(capacitorMocks.durableGet).toHaveBeenCalledWith({
      key: 'planner.auth.sb-test-auth-token',
    })
    expect(capacitorMocks.durableSet).toHaveBeenCalledWith({
      key: 'planner.auth.sb-test-auth-token',
      value: 'fresh-session',
    })
    expect(capacitorMocks.durableRemove).toHaveBeenCalledWith({
      key: 'planner.auth.sb-test-auth-token',
    })
  })

  it('clears multiple stored auth keys', async () => {
    await clearNativeSessionStorage(['sb-token', 'sb-token-user'])

    expect(capacitorMocks.durableRemove).toHaveBeenNthCalledWith(1, {
      key: 'planner.auth.sb-token',
    })
    expect(capacitorMocks.durableRemove).toHaveBeenNthCalledWith(2, {
      key: 'planner.auth.sb-token-user',
    })
  })

  it('coordinates refresh preparation and commit through the native bridge', async () => {
    capacitorMocks.prepareRefresh.mockResolvedValue({
      value: 'prepared-session',
    })
    capacitorMocks.commitRefresh.mockResolvedValue({
      value: 'committed-session',
    })

    await expect(
      prepareNativeAuthSessionRefresh('expected-session'),
    ).resolves.toBe('prepared-session')
    await expect(
      commitNativeAuthSessionRefresh('prepared-session', 'refreshed-session'),
    ).resolves.toBe('committed-session')
    expect(capacitorMocks.prepareRefresh).toHaveBeenCalledWith({
      expectedSession: 'expected-session',
    })
    expect(capacitorMocks.commitRefresh).toHaveBeenCalledWith({
      attemptedSession: 'prepared-session',
      refreshedSession: 'refreshed-session',
    })
  })

  it('bridges native app lifecycle events', async () => {
    const remove = vi.fn()
    const listener = vi.fn()

    capacitorMocks.getState.mockResolvedValue({ isActive: true })
    capacitorMocks.addListener.mockImplementation(
      (_event: string, callback: (state: { isActive: boolean }) => void) => {
        callback({ isActive: false })

        return Promise.resolve({ remove })
      },
    )

    await expect(getNativeAppIsActive()).resolves.toBe(true)
    await expect(addNativeAppStateChangeListener(listener)).resolves.toEqual({
      remove,
    })

    expect(capacitorMocks.addListener).toHaveBeenCalledWith(
      'appStateChange',
      expect.any(Function),
    )
    expect(listener).toHaveBeenCalledWith(false)
  })
})
