import { useEffect } from 'react'

import { plannerApiConfig } from '@/shared/config/planner-api'

import {
  isAndroidPushNotificationsRuntime,
  registerNativePushNotifications,
} from '../lib/native-push-notifications'
import { createPushNotificationsApiClient } from '../lib/push-notifications-api'
import { usePlannerSession } from '../lib/usePlannerSession'
import { useSessionAuth } from '../lib/useSessionAuth'

export function NativePushRegistration() {
  const { accessToken } = useSessionAuth()
  const { data: session } = usePlannerSession()
  const actorUserId = session?.actorUserId ?? null
  const workspaceId = session?.workspaceId ?? null

  useEffect(() => {
    if (!actorUserId || !workspaceId || !isAndroidPushNotificationsRuntime()) {
      return
    }

    const apiClient = createPushNotificationsApiClient({
      ...(accessToken ? { accessToken } : {}),
      actorUserId,
      apiBaseUrl: plannerApiConfig.apiBaseUrl,
      workspaceId,
    })

    let isDisposed = false
    let cleanup: (() => Promise<void>) | null = null

    void registerNativePushNotifications({
      actorUserId,
      apiClient,
      workspaceId,
    })
      .then((dispose) => {
        if (isDisposed) {
          void dispose()
          return
        }

        cleanup = dispose
      })
      .catch((error) => {
        console.error('Failed to bootstrap Android push notifications.', error)
      })

    return () => {
      isDisposed = true

      if (cleanup) {
        void cleanup()
      }
    }
  }, [accessToken, actorUserId, workspaceId])

  return null
}
