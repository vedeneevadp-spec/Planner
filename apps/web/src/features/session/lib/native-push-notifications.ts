import { App } from '@capacitor/app'
import {
  type PermissionState,
  type PluginListenerHandle,
} from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import {
  PushNotifications,
  type PushNotificationSchema,
  type Token,
} from '@capacitor/push-notifications'

import { isAndroidNativeRuntime } from '@/shared/lib/native-runtime'

import {
  createPushNotificationsApiClient,
  type PushNotificationsApiClient,
} from './push-notifications-api'
import { setSelectedWorkspaceId } from './workspace-selection'

const PUSH_CHANNEL_ID = 'chaotika-general'
const PUSH_STORAGE_PREFIX = 'planner.push.'
const PUSH_INSTALLATION_ID_KEY = `${PUSH_STORAGE_PREFIX}installation-id`
const PUSH_REGISTRATION_CONTEXT_KEY = `${PUSH_STORAGE_PREFIX}registration-context`
const SAFE_PUSH_PATHS = new Set([
  '/notifications/settings',
  '/self-care',
  '/today',
])
const SHARED_TASK_NOTIFICATION_TYPES = new Set([
  'shared-task-assigned',
  'shared-task-created',
  'shared-task-ready-for-review',
])
const PUSH_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export type NativePushPermissionStatus = PermissionState | 'unavailable'

export interface PushNotificationNavigationTarget {
  path: string
  workspaceId?: string | undefined
}

export interface StoredPushRegistrationContext {
  actorUserId: string
  installationId: string
  workspaceId: string
}

interface RegisterNativePushNotificationsOptions {
  actorUserId: string
  apiClient: PushNotificationsApiClient
  navigate?: ((path: string) => void) | undefined
  workspaceId: string
}

export function isAndroidPushNotificationsRuntime(): boolean {
  return isAndroidNativeRuntime()
}

export async function getNativePushPermissionStatus(): Promise<NativePushPermissionStatus> {
  if (!isAndroidPushNotificationsRuntime()) {
    return 'unavailable'
  }

  return (await PushNotifications.checkPermissions()).receive
}

export async function requestNativePushPermission(): Promise<NativePushPermissionStatus> {
  if (!isAndroidPushNotificationsRuntime()) {
    return 'unavailable'
  }

  const current = await PushNotifications.checkPermissions()
  const receive =
    current.receive === 'granted'
      ? current.receive
      : (await PushNotifications.requestPermissions()).receive

  if (receive === 'granted') {
    await PushNotifications.register()
  }

  return receive
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
        handlePushNotificationAction(
          notification,
          options.actorUserId,
          options.navigate,
        )
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
    await unregisterNativePushToken()
    return
  }

  const actorUserId = options.actorUserId ?? context.actorUserId
  let removedFromServer = false

  if (actorUserId || options.accessToken) {
    const apiClient = createPushNotificationsApiClient({
      ...(options.accessToken ? { accessToken: options.accessToken } : {}),
      actorUserId: actorUserId ?? context.actorUserId,
      apiBaseUrl: options.apiBaseUrl,
      workspaceId: context.workspaceId,
    })

    try {
      await apiClient.removeDevice(context.installationId)
      removedFromServer = true
    } catch (error) {
      console.warn('Failed to unregister Android push device.', error)
    }
  }

  const unregisteredNatively = await unregisterNativePushToken()

  if (removedFromServer || unregisteredNatively) {
    await clearStoredPushRegistrationContext()
  }
}

async function unregisterNativePushToken(): Promise<boolean> {
  try {
    await PushNotifications.unregister()
    return true
  } catch (error) {
    console.warn('Failed to unregister the native Android push token.', error)
    return false
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
  actorUserId: string,
  navigate: (path: string) => void = (path) => {
    window.location.assign(path)
  },
): void {
  const target = resolvePushNotificationNavigation(notification.data)

  if (!target) {
    return
  }

  if (target.workspaceId) {
    setSelectedWorkspaceId(target.workspaceId, actorUserId)
  }

  navigate(target.path)
}

export function resolvePushNotificationNavigation(
  notificationData: unknown,
): PushNotificationNavigationTarget | null {
  if (!notificationData || typeof notificationData !== 'object') {
    return null
  }

  const record = notificationData as Record<string, unknown>
  const path = typeof record.path === 'string' ? record.path : null

  if (!path || !SAFE_PUSH_PATHS.has(path)) {
    return null
  }

  const taskId = normalizePushIdentifier(record.taskId)
  const workspaceId = normalizePushIdentifier(record.workspaceId)
  const type = typeof record.type === 'string' ? record.type : null

  if (
    (record.taskId !== undefined && taskId === null) ||
    (record.workspaceId !== undefined && workspaceId === null)
  ) {
    return null
  }

  const isSharedTaskNotification =
    type !== null && SHARED_TASK_NOTIFICATION_TYPES.has(type)

  if (isSharedTaskNotification) {
    if (path !== '/today' || !taskId || !workspaceId) {
      return null
    }

    return {
      path: `/today?taskId=${encodeURIComponent(taskId)}`,
      workspaceId,
    }
  }

  if (path === '/today' && taskId) {
    return {
      path: `/today?taskId=${encodeURIComponent(taskId)}`,
      ...(workspaceId ? { workspaceId } : {}),
    }
  }

  if (taskId) {
    return null
  }

  return {
    path,
    ...(workspaceId ? { workspaceId } : {}),
  }
}

function normalizePushIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()

  return PUSH_IDENTIFIER_PATTERN.test(normalizedValue) ? normalizedValue : null
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
