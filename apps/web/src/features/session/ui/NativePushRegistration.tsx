import { useEffect } from 'react'

import {
  isAndroidPushNotificationsRuntime,
  registerNativePushNotifications,
} from '../lib/native-push-notifications'
import { createPushNotificationsApiClient } from '../lib/push-notifications-api'
import { useSessionFeatureReadiness } from '../lib/useSessionFeatureReadiness'

export function NativePushRegistration() {
  const { apiConfig, session } = useSessionFeatureReadiness()

  useEffect(() => {
    if (!apiConfig || !session || !isAndroidPushNotificationsRuntime()) {
      return
    }

    const apiClient = createPushNotificationsApiClient(apiConfig)

    let isDisposed = false
    let cleanup: (() => Promise<void>) | null = null

    void registerNativePushNotifications({
      actorUserId: session.actorUserId,
      apiClient,
      workspaceId: session.workspaceId,
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
  }, [apiConfig, session])

  return null
}
