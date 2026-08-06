import { useSyncExternalStore } from 'react'

function getBrowserOfflineSnapshot(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function subscribeToBrowserConnectionState(onChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)

  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function useBrowserOffline(): boolean {
  return useSyncExternalStore(
    subscribeToBrowserConnectionState,
    getBrowserOfflineSnapshot,
    () => false,
  )
}
