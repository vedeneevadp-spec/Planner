import { Capacitor } from '@capacitor/core'

const SERVICE_WORKER_PATH = '/sw.js'

interface ServiceWorkerRegistrationLike {
  update: () => Promise<unknown>
}

interface ServiceWorkerContainerLike {
  controller: unknown
  addEventListener: (type: 'controllerchange', listener: () => void) => void
  register: (scriptURL: string) => Promise<ServiceWorkerRegistrationLike>
}

interface PwaServiceWorkerWindowLike {
  addEventListener: (type: 'load', listener: () => void) => void
  location: {
    reload: () => void
  }
}

interface PwaServiceWorkerRegistrationOptions {
  isDev: boolean
  isNativePlatform: boolean
  navigator: {
    serviceWorker?: ServiceWorkerContainerLike | undefined
  }
  window: PwaServiceWorkerWindowLike
  onError?: ((error: unknown) => void) | undefined
}

export function registerPwaServiceWorker() {
  registerPwaServiceWorkerWithEnv({
    isDev: import.meta.env.DEV,
    isNativePlatform: Capacitor.isNativePlatform(),
    navigator,
    window,
    onError(error) {
      console.error('Failed to register service worker', error)
    },
  })
}

export function registerPwaServiceWorkerWithEnv({
  isDev,
  isNativePlatform,
  navigator,
  onError,
  window,
}: PwaServiceWorkerRegistrationOptions) {
  if (isDev || isNativePlatform || !navigator.serviceWorker) {
    return
  }

  const serviceWorker = navigator.serviceWorker
  const shouldReloadOnControllerChange = Boolean(serviceWorker.controller)
  let hasReloadedForUpdate = false

  if (shouldReloadOnControllerChange) {
    serviceWorker.addEventListener('controllerchange', () => {
      if (hasReloadedForUpdate) {
        return
      }

      hasReloadedForUpdate = true
      window.location.reload()
    })
  }

  window.addEventListener('load', () => {
    serviceWorker
      .register(SERVICE_WORKER_PATH)
      .then((registration) => registration.update())
      .catch((error: unknown) => {
        onError?.(error)
      })
  })
}
