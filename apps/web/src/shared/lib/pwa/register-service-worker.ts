import { Capacitor } from '@capacitor/core'

export function registerPwaServiceWorker() {
  if (import.meta.env.DEV || Capacitor.isNativePlatform()) {
    return
  }

  if (!('serviceWorker' in navigator)) {
    return
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.error('Failed to register service worker', error)
    })
  })
}
