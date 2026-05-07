import { App } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

const NATIVE_AUTH_STORAGE_PREFIX = 'planner.auth.'

export interface AuthStorage {
  getItem: (key: string) => Promise<string | null> | string | null
  removeItem: (key: string) => Promise<void> | void
  setItem: (key: string, value: string) => Promise<void> | void
}

export function isNativeSessionPersistenceRuntime(): boolean {
  return Capacitor.isNativePlatform()
}

export function createNativeSessionStorage(): AuthStorage {
  return {
    async getItem(key) {
      const { value } = await Preferences.get({
        key: toNativeAuthStorageKey(key),
      })

      return value
    },
    async removeItem(key) {
      await Preferences.remove({
        key: toNativeAuthStorageKey(key),
      })
    },
    async setItem(key, value) {
      await Preferences.set({
        key: toNativeAuthStorageKey(key),
        value,
      })
    },
  }
}

export async function clearNativeSessionStorage(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((key) =>
      Preferences.remove({
        key: toNativeAuthStorageKey(key),
      }),
    ),
  )
}

export async function getNativeAppIsActive(): Promise<boolean> {
  const { isActive } = await App.getState()

  return isActive
}

export async function addNativeAppStateChangeListener(
  listener: (isActive: boolean) => void,
): Promise<PluginListenerHandle> {
  return App.addListener('appStateChange', ({ isActive }) => {
    listener(isActive)
  })
}

function toNativeAuthStorageKey(key: string): string {
  return `${NATIVE_AUTH_STORAGE_PREFIX}${key}`
}
