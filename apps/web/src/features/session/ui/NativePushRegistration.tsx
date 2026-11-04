import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import {
  isAndroidPushNotificationsRuntime,
  registerNativePushNotifications,
} from '../lib/native-push-notifications'
import { createPushNotificationsApiClient } from '../lib/push-notifications-api'
import { useSessionFeatureReadiness } from '../lib/useSessionFeatureReadiness'

export function NativePushRegistration() {
  const queryClient = useQueryClient()
  const { apiConfig, session } = useSessionFeatureReadiness()

  useEffect(() => {
    if (!isAndroidPushNotificationsRuntime()) return
    const refreshTasks = () => {
      void queryClient.invalidateQueries({ queryKey: ['planner', 'tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['planner-search'] })
    }
    window.addEventListener('planner:task-notification-completed', refreshTasks)
    return () =>
      window.removeEventListener(
        'planner:task-notification-completed',
        refreshTasks,
      )
  }, [queryClient])

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
