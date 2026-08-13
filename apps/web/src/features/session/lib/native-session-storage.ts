import { App } from '@capacitor/app'
import {
  Capacitor,
  type PluginListenerHandle,
  registerPlugin,
} from '@capacitor/core'

const NATIVE_AUTH_STORAGE_PREFIX = 'planner.auth.'
const NATIVE_AUTH_DEVICE_ID_STORAGE_KEY = `${NATIVE_AUTH_STORAGE_PREFIX}deviceId`
const plannerAuthStorage =
  registerPlugin<PlannerAuthStoragePlugin>('PlannerAuthStorage')

interface PlannerAuthStoragePlugin {
  get: (options: { key: string }) => Promise<{ value: string | null }>
  remove: (options: { key: string }) => Promise<void>
  set: (options: { key: string; value: string }) => Promise<void>
}

export interface AuthStorage {
  getItem: (key: string) => Promise<string | null> | string | null
  removeItem: (key: string) => Promise<void> | void
  setItem: (key: string, value: string) => Promise<void> | void
}

export function isNativeSessionPersistenceRuntime(): boolean {
  return Capacitor.isNativePlatform()
}

export async function getNativeAuthDeviceId(): Promise<string | null> {
  if (!isNativeSessionPersistenceRuntime()) {
    return null
  }

  const { value } = await plannerAuthStorage.get({
    key: NATIVE_AUTH_DEVICE_ID_STORAGE_KEY,
  })
  const storedDeviceId = normalizeDeviceId(value)

  if (storedDeviceId) {
    return storedDeviceId
  }

  const nextDeviceId = createNativeAuthDeviceId()

  await setNativePreference(NATIVE_AUTH_DEVICE_ID_STORAGE_KEY, nextDeviceId)

  return nextDeviceId
}

export function createNativeSessionStorage(): AuthStorage {
  return {
    async getItem(key) {
      const { value } = await plannerAuthStorage.get({
        key: toNativeAuthStorageKey(key),
      })

      return value
    },
    async removeItem(key) {
      await removeNativePreference(toNativeAuthStorageKey(key))
    },
    async setItem(key, value) {
      await setNativePreference(toNativeAuthStorageKey(key), value)
    },
  }
}

export async function clearNativeSessionStorage(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((key) => removeNativePreference(toNativeAuthStorageKey(key))),
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

async function setNativePreference(key: string, value: string): Promise<void> {
  await plannerAuthStorage.set({ key, value })
}

async function removeNativePreference(key: string): Promise<void> {
  await plannerAuthStorage.remove({ key })
}

function normalizeDeviceId(deviceId: string | null | undefined): string | null {
  const normalizedDeviceId = deviceId?.trim()

  return normalizedDeviceId && normalizedDeviceId.length <= 128
    ? normalizedDeviceId
    : null
}

function createNativeAuthDeviceId(): string {
  const randomUUID =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

  return `native-${randomUUID}`
}
