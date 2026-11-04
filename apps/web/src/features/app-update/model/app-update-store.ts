import { useSyncExternalStore } from 'react'

export interface AppUpdateControls {
  installedVersion: string | null
  checking: boolean
  busy: boolean
  check: () => void
}

let controls: AppUpdateControls | null = null
const listeners = new Set<() => void>()

export function setAppUpdateControls(next: AppUpdateControls | null) {
  controls = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getControls = () => controls

export function useAppUpdate() {
  return useSyncExternalStore(subscribe, getControls, getControls)
}
