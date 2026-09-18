import { afterEach, describe, expect, it, vi } from 'vitest'

import { openAndroidSystemAppSettings } from './native-app-settings'

const mocks = vi.hoisted(() => ({
  isAndroidNativeRuntime: vi.fn(() => true),
  openSystemAppSettings: vi.fn<() => Promise<void>>(),
  registerPlugin: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  registerPlugin: (name: string) => {
    mocks.registerPlugin(name)
    return { openSystemAppSettings: mocks.openSystemAppSettings }
  },
}))

vi.mock('./native-runtime', () => ({
  isAndroidNativeRuntime: mocks.isAndroidNativeRuntime,
}))

describe('openAndroidSystemAppSettings', () => {
  afterEach(() => {
    mocks.isAndroidNativeRuntime.mockReset().mockReturnValue(true)
    mocks.openSystemAppSettings.mockReset()
  })

  it('opens app settings through the neutral Android plugin', async () => {
    mocks.openSystemAppSettings.mockResolvedValue(undefined)

    await openAndroidSystemAppSettings()

    expect(mocks.registerPlugin).toHaveBeenCalledWith('PlannerAppSettings')
    expect(mocks.openSystemAppSettings).toHaveBeenCalledOnce()
  })

  it('propagates native errors for the settings page to display', async () => {
    const error = new Error('System settings are unavailable.')
    mocks.openSystemAppSettings.mockRejectedValue(error)

    await expect(openAndroidSystemAppSettings()).rejects.toBe(error)
  })

  it('does not invoke native settings outside Android', async () => {
    mocks.isAndroidNativeRuntime.mockReturnValue(false)

    await expect(openAndroidSystemAppSettings()).resolves.toBeUndefined()

    expect(mocks.openSystemAppSettings).not.toHaveBeenCalled()
  })
})
