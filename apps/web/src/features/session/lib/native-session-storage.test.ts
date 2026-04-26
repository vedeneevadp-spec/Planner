import { beforeEach, describe, expect, it, vi } from 'vitest'

const capacitorMocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  get: vi.fn(),
  getState: vi.fn(),
  isNativePlatform: vi.fn(),
  remove: vi.fn(),
  set: vi.fn(),
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: capacitorMocks.addListener,
    getState: capacitorMocks.getState,
  },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: capacitorMocks.isNativePlatform,
  },
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: capacitorMocks.get,
    remove: capacitorMocks.remove,
    set: capacitorMocks.set,
  },
}))

import {
  addNativeAppStateChangeListener,
  clearNativeSessionStorage,
  createNativeSessionStorage,
  getNativeAppIsActive,
  isNativeSessionPersistenceRuntime,
} from './native-session-storage'

describe('native session storage', () => {
  beforeEach(() => {
    capacitorMocks.addListener.mockReset()
    capacitorMocks.get.mockReset()
    capacitorMocks.getState.mockReset()
    capacitorMocks.isNativePlatform.mockReset()
    capacitorMocks.remove.mockReset()
    capacitorMocks.set.mockReset()
  })

  it('detects native runtime through Capacitor', () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true)

    expect(isNativeSessionPersistenceRuntime()).toBe(true)
  })

  it('reads and writes auth values through Capacitor Preferences', async () => {
    const storage = createNativeSessionStorage()
    capacitorMocks.get.mockResolvedValue({ value: 'stored-session' })

    await expect(storage.getItem('sb-test-auth-token')).resolves.toBe(
      'stored-session',
    )
    await storage.setItem('sb-test-auth-token', 'fresh-session')
    await storage.removeItem('sb-test-auth-token')

    expect(capacitorMocks.get).toHaveBeenCalledWith({
      key: 'planner.auth.sb-test-auth-token',
    })
    expect(capacitorMocks.set).toHaveBeenCalledWith({
      key: 'planner.auth.sb-test-auth-token',
      value: 'fresh-session',
    })
    expect(capacitorMocks.remove).toHaveBeenCalledWith({
      key: 'planner.auth.sb-test-auth-token',
    })
  })

  it('clears multiple stored auth keys', async () => {
    await clearNativeSessionStorage(['sb-token', 'sb-token-user'])

    expect(capacitorMocks.remove).toHaveBeenNthCalledWith(1, {
      key: 'planner.auth.sb-token',
    })
    expect(capacitorMocks.remove).toHaveBeenNthCalledWith(2, {
      key: 'planner.auth.sb-token-user',
    })
  })

  it('bridges native app lifecycle events', async () => {
    const remove = vi.fn()
    const listener = vi.fn()

    capacitorMocks.getState.mockResolvedValue({ isActive: true })
    capacitorMocks.addListener.mockImplementation(
      (
        _event: string,
        callback: (state: { isActive: boolean }) => void,
      ) => {
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
