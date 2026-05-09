import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  addNativePlannerWidgetResumeListener,
  buildNativePlannerWidgetSnapshot,
  consumePendingNativePlannerWidgetRoute,
  isAndroidPlannerWidgetRuntime,
  persistNativePlannerWidgetSnapshot,
} from '../lib/native-planner-widget'
import { usePlanner } from '../lib/usePlanner'

export function NativePlannerWidgetSync() {
  const { isLoading, tasks } = usePlanner()
  const navigate = useNavigate()

  const syncSnapshot = useCallback(() => {
    if (isLoading || !isAndroidPlannerWidgetRuntime()) {
      return
    }

    const snapshot = buildNativePlannerWidgetSnapshot(tasks)

    void persistNativePlannerWidgetSnapshot(snapshot).catch((error) => {
      console.warn('Failed to update Android planner widget.', error)
    })
  }, [isLoading, tasks])

  const consumePendingRoute = useCallback(() => {
    if (!isAndroidPlannerWidgetRuntime()) {
      return
    }

    void consumePendingNativePlannerWidgetRoute()
      .then((path) => {
        if (path) {
          void navigate(path)
        }
      })
      .catch((error) => {
        console.warn('Failed to open planner widget route.', error)
      })
  }, [navigate])

  useEffect(() => {
    syncSnapshot()
  }, [syncSnapshot])

  useEffect(() => {
    consumePendingRoute()
  }, [consumePendingRoute])

  useEffect(() => {
    if (!isAndroidPlannerWidgetRuntime()) {
      return
    }

    let isDisposed = false
    const listenerHandlePromise = addNativePlannerWidgetResumeListener(() => {
      if (isDisposed) {
        return
      }

      consumePendingRoute()
      syncSnapshot()
    })

    return () => {
      isDisposed = true
      void listenerHandlePromise
        .then((handle) => {
          void handle.remove()
        })
        .catch((error) => {
          console.warn('Failed to remove planner widget listener.', error)
        })
    }
  }, [consumePendingRoute, syncSnapshot])

  return null
}
