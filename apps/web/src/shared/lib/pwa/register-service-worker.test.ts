import { describe, expect, it, vi } from 'vitest'

import { registerPwaServiceWorkerWithEnv } from './register-service-worker'

function createRegistrationTestEnv(options: { hasController?: boolean } = {}) {
  const listeners: Partial<Record<'controllerchange' | 'load', () => void>> = {}
  const update = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined)
  const register = vi
    .fn<(scriptURL: string) => Promise<{ update: typeof update }>>()
    .mockResolvedValue({ update })
  const reload = vi.fn()
  const addServiceWorkerListener = vi.fn(
    (type: 'controllerchange', listener: () => void) => {
      listeners[type] = listener
    },
  )
  const addWindowListener = vi.fn((type: 'load', listener: () => void) => {
    listeners[type] = listener
  })

  return {
    env: {
      isDev: false,
      isNativePlatform: false,
      navigator: {
        serviceWorker: {
          addEventListener: addServiceWorkerListener,
          controller: options.hasController ? {} : null,
          register,
        },
      },
      window: {
        addEventListener: addWindowListener,
        location: {
          reload,
        },
      },
    },
    listeners,
    register,
    reload,
    update,
  }
}

describe('registerPwaServiceWorkerWithEnv', () => {
  it('skips registration in development and native runtimes', () => {
    const dev = createRegistrationTestEnv()
    registerPwaServiceWorkerWithEnv({
      ...dev.env,
      isDev: true,
    })

    const native = createRegistrationTestEnv()
    registerPwaServiceWorkerWithEnv({
      ...native.env,
      isNativePlatform: true,
    })

    expect(dev.register).not.toHaveBeenCalled()
    expect(native.register).not.toHaveBeenCalled()
  })

  it('registers the app service worker on page load and checks for updates', async () => {
    const { env, listeners, register, update } = createRegistrationTestEnv()

    registerPwaServiceWorkerWithEnv(env)
    listeners.load?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(register).toHaveBeenCalledWith('/sw.js')
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('reloads an already controlled app once when the service worker changes', () => {
    const { env, listeners, reload } = createRegistrationTestEnv({
      hasController: true,
    })

    registerPwaServiceWorkerWithEnv(env)
    listeners.controllerchange?.()
    listeners.controllerchange?.()

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload on first service worker install', () => {
    const { env, listeners, reload } = createRegistrationTestEnv()

    registerPwaServiceWorkerWithEnv(env)
    listeners.controllerchange?.()

    expect(reload).not.toHaveBeenCalled()
  })
})
