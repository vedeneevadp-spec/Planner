import { describe, expect, it, vi } from 'vitest'

import { createBrowserAuthDeviceIdResolver } from './browser-auth-device-id'

const FIRST_UUID = '018f3f10-7b5c-7000-8000-000000000001'
const SECOND_UUID = '018f3f10-7b5c-7000-8000-000000000002'

describe('browser auth device id', () => {
  it('persists one stable browser device id across resolver instances', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value)
      }),
    }
    const firstResolver = createBrowserAuthDeviceIdResolver({
      createUuid: () => FIRST_UUID,
      getStorage: () => storage,
    })
    const secondResolver = createBrowserAuthDeviceIdResolver({
      createUuid: () => SECOND_UUID,
      getStorage: () => storage,
    })

    expect(firstResolver()).toBe(`browser-${FIRST_UUID}`)
    expect(firstResolver()).toBe(`browser-${FIRST_UUID}`)
    expect(secondResolver()).toBe(`browser-${FIRST_UUID}`)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
  })

  it('keeps an in-memory id stable when localStorage operations fail', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new DOMException('Storage is disabled.', 'SecurityError')
      }),
      setItem: vi.fn(() => {
        throw new DOMException('Storage is disabled.', 'SecurityError')
      }),
    }
    const resolver = createBrowserAuthDeviceIdResolver({
      createUuid: () => FIRST_UUID,
      getStorage: () => storage,
    })

    expect(resolver()).toBe(`browser-${FIRST_UUID}`)
    expect(resolver()).toBe(`browser-${FIRST_UUID}`)
    expect(storage.getItem).toHaveBeenCalledTimes(2)
    expect(storage.setItem).toHaveBeenCalledTimes(2)
  })

  it('falls back to memory when access to localStorage itself throws', () => {
    const resolver = createBrowserAuthDeviceIdResolver({
      createUuid: () => FIRST_UUID,
      getStorage: () => {
        throw new DOMException('Storage is blocked.', 'SecurityError')
      },
    })

    expect(resolver()).toBe(`browser-${FIRST_UUID}`)
    expect(resolver()).toBe(`browser-${FIRST_UUID}`)
  })

  it('replaces malformed persisted ids with a generated UUID', () => {
    const storage = {
      getItem: vi.fn(() => 'browser-not-a-uuid'),
      setItem: vi.fn(),
    }
    const resolver = createBrowserAuthDeviceIdResolver({
      createUuid: () => FIRST_UUID,
      getStorage: () => storage,
    })

    expect(resolver()).toBe(`browser-${FIRST_UUID}`)
    expect(storage.setItem).toHaveBeenCalledWith(
      'planner.auth.browserDeviceId',
      `browser-${FIRST_UUID}`,
    )
  })
})
