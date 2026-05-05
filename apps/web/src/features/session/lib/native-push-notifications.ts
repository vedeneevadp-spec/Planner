import { App } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import {
  PushNotifications,
  type PushNotificationSchema,
  type Token,
} from '@capacitor/push-notifications'

import {
  createPushNotificationsApiClient,
  type PushNotificationsApiClient,
} from './push-notifications-api'

const PUSH_CHANNEL_ID = 'chaotika-general'
const PUSH_STORAGE_PREFIX = 'planner.push.'
const PUSH_INSTALLATION_ID_KEY = `${PUSH_STORAGE_PREFIX}installation-id`
const PUSH_REGISTRATION_CONTEXT_KEY = `${PUSH_STORAGE_PREFIX}registration-context`

export interface StoredPushRegistrationContext {
  actorUserId: string
  installationId: string
  workspaceId: string
}

interface RegisterNativePushNotificationsOptions {
  actorUserId: string
  apiClient: PushNotificationsApiClient
  workspaceId: string
}

export function isAndroidPushNotificationsRuntime(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function registerNativePushNotifications(
  options: RegisterNativePushNotificationsOptions,
): Promise<() => Promise<void>> {
  const installationId = await getOrCreatePushInstallationId()
  const listenerHandles: PluginListenerHandle[] = []

  listenerHandles.push(
    await PushNotifications.addListener('registration', (token) => {
      void upsertRegisteredPushDevice({
        actorUserId: options.actorUserId,
        apiClient: options.apiClient,
        installationId,
        token,
        workspaceId: options.workspaceId,
      }).catch((error) => {
        console.error('Failed to register Android push token.', error)
      })
    }),
  )
  listenerHandles.push(
    await PushNotifications.addListener('registrationError', (error) => {
      console.error('Android push registration failed.', error)
    }),
  )
  listenerHandles.push(
    await PushNotifications.addListener('pushNotificationReceived', () => {
      return
    }),
  )
  listenerHandles.push(
    await PushNotifications.addListener(
      'pushNotificationActionPerformed',
      ({ notification }) => {
        handlePushNotificationAction(notification)
      },
    ),
  )

  await PushNotifications.createChannel({
    description: 'Основные push-уведомления Chaotika',
    id: PUSH_CHANNEL_ID,
    importance: 5,
    name: 'Chaotika',
    sound: 'default',
    visibility: 1,
  })

  const permissions = await PushNotifications.checkPermissions()
  const receivePermission =
    permissions.receive === 'prompt'
      ? (await PushNotifications.requestPermissions()).receive
      : permissions.receive

  if (receivePermission !== 'granted') {
    return async () => {
      await Promise.all(listenerHandles.map((handle) => handle.remove()))
    }
  }

  await PushNotifications.register()

  return async () => {
    await Promise.all(listenerHandles.map((handle) => handle.remove()))
  }
}

export async function unregisterStoredNativePushDevice(options: {
  accessToken?: string | null | undefined
  actorUserId?: string | null | undefined
  apiBaseUrl: string
}): Promise<void> {
  if (!isAndroidPushNotificationsRuntime()) {
    return
  }

  const context = await readStoredPushRegistrationContext()

  if (!context) {
    return
  }

  const actorUserId = options.actorUserId ?? context.actorUserId

  if (!actorUserId && !options.accessToken) {
    await clearStoredPushRegistrationContext()
    return
  }

  const apiClient = createPushNotificationsApiClient({
    ...(options.accessToken ? { accessToken: options.accessToken } : {}),
    actorUserId: actorUserId ?? context.actorUserId,
    apiBaseUrl: options.apiBaseUrl,
    workspaceId: context.workspaceId,
  })

  try {
    await apiClient.removeDevice(context.installationId)
  } catch (error) {
    console.warn('Failed to unregister Android push device.', error)
  } finally {
    await clearStoredPushRegistrationContext()
  }
}

async function upsertRegisteredPushDevice(options: {
  actorUserId: string
  apiClient: PushNotificationsApiClient
  installationId: string
  token: Token
  workspaceId: string
}): Promise<void> {
  const appInfo = await App.getInfo().catch(() => null)

  await options.apiClient.upsertDevice({
    appVersion: appInfo?.version,
    installationId: options.installationId,
    locale: resolveDeviceLocale(),
    platform: 'android',
    token: options.token.value,
  })
  await storePushRegistrationContext({
    actorUserId: options.actorUserId,
    installationId: options.installationId,
    workspaceId: options.workspaceId,
  })
}

function handlePushNotificationAction(
  notification: PushNotificationSchema,
): void {
  const notificationData: unknown = notification.data

  if (!notificationData || typeof notificationData !== 'object') {
    return
  }

  const pathValue =
    'path' in notificationData ? notificationData.path : undefined

  if (typeof pathValue !== 'string' || !pathValue.startsWith('/')) {
    return
  }

  window.location.assign(pathValue)
}

function resolveDeviceLocale(): string {
  return (
    Intl.DateTimeFormat().resolvedOptions().locale || navigator.language || 'en'
  )
}

async function getOrCreatePushInstallationId(): Promise<string> {
  const storedValue = await Preferences.get({
    key: PUSH_INSTALLATION_ID_KEY,
  })

  if (storedValue.value) {
    return storedValue.value
  }

  const installationId = crypto.randomUUID()

  await Preferences.set({
    key: PUSH_INSTALLATION_ID_KEY,
    value: installationId,
  })

  return installationId
}

async function readStoredPushRegistrationContext(): Promise<StoredPushRegistrationContext | null> {
  const { value } = await Preferences.get({
    key: PUSH_REGISTRATION_CONTEXT_KEY,
  })

  if (!value) {
    return null
  }

  try {
    const parsedValue = JSON.parse(
      value,
    ) as Partial<StoredPushRegistrationContext>

    if (
      typeof parsedValue.actorUserId !== 'string' ||
      typeof parsedValue.installationId !== 'string' ||
      typeof parsedValue.workspaceId !== 'string'
    ) {
      return null
    }

    return {
      actorUserId: parsedValue.actorUserId,
      installationId: parsedValue.installationId,
      workspaceId: parsedValue.workspaceId,
    }
  } catch {
    return null
  }
}

async function storePushRegistrationContext(
  context: StoredPushRegistrationContext,
): Promise<void> {
  await Preferences.set({
    key: PUSH_REGISTRATION_CONTEXT_KEY,
    value: JSON.stringify(context),
  })
}

async function clearStoredPushRegistrationContext(): Promise<void> {
  await Preferences.remove({
    key: PUSH_REGISTRATION_CONTEXT_KEY,
  })
}
