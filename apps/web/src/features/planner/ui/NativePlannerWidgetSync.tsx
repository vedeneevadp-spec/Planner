import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  addNativePlannerWidgetResumeListener,
  buildNativePlannerWidgetSnapshot,
  consumePendingNativePlannerWidgetCompletedTasks,
  consumePendingNativePlannerWidgetRoute,
  isAndroidPlannerWidgetRuntime,
  persistNativePlannerWidgetSnapshot,
} from '../lib/native-planner-widget'
import { usePlanner } from '../lib/usePlanner'

export function NativePlannerWidgetSync() {
  const { isLoading, isSyncing, setTaskStatus, spheres, tasks } = usePlanner()
  const navigate = useNavigate()
  const plannerRef = useRef({ isLoading, setTaskStatus, spheres, tasks })
  const wasSyncingRef = useRef(false)

  useEffect(() => {
    plannerRef.current = { isLoading, setTaskStatus, spheres, tasks }
  }, [isLoading, setTaskStatus, spheres, tasks])

  const syncSnapshot = useCallback(() => {
    const planner = plannerRef.current

    if (planner.isLoading || !isAndroidPlannerWidgetRuntime()) {
      return
    }

    const snapshot = buildNativePlannerWidgetSnapshot(
      planner.tasks,
      planner.spheres,
    )

    void persistNativePlannerWidgetSnapshot(snapshot).catch((error) => {
      console.warn('Failed to update Android planner widget.', error)
    })
  }, [])

  const consumePendingCompletedTasks =
    useCallback(async (): Promise<boolean> => {
      const planner = plannerRef.current

      if (planner.isLoading || !isAndroidPlannerWidgetRuntime()) {
        return false
      }

      const taskIds = await consumePendingNativePlannerWidgetCompletedTasks()
      let didCompleteTask = false

      for (const taskId of new Set(taskIds)) {
        const task = planner.tasks.find((candidate) => candidate.id === taskId)

        if (!task || task.status === 'done') {
          continue
        }

        didCompleteTask =
          (await planner.setTaskStatus(taskId, 'done')) || didCompleteTask
      }

      return didCompleteTask
    }, [])

  const syncFromNativeWidget = useCallback(() => {
    if (!isAndroidPlannerWidgetRuntime()) {
      return
    }

    void consumePendingCompletedTasks()
      .then((didCompleteTask) => {
        if (!didCompleteTask) {
          syncSnapshot()
        }
      })
      .catch((error) => {
        console.warn('Failed to sync Android planner widget.', error)
      })
  }, [consumePendingCompletedTasks, syncSnapshot])

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
    syncFromNativeWidget()
  }, [isLoading, spheres, syncFromNativeWidget, tasks])

  useEffect(() => {
    consumePendingRoute()
  }, [consumePendingRoute])

  useEffect(() => {
    if (!isAndroidPlannerWidgetRuntime()) {
      return
    }

    if (wasSyncingRef.current && !isSyncing) {
      syncFromNativeWidget()
    }

    wasSyncingRef.current = isSyncing
  }, [isSyncing, syncFromNativeWidget])

  useEffect(() => {
    if (!isAndroidPlannerWidgetRuntime()) {
      return
    }

    let timeoutId: number | undefined

    function scheduleNextDaySync() {
      const now = new Date()
      const nextDay = new Date(now)

      nextDay.setDate(now.getDate() + 1)
      nextDay.setHours(0, 0, 5, 0)

      timeoutId = window.setTimeout(
        () => {
          syncFromNativeWidget()
          scheduleNextDaySync()
        },
        Math.max(1_000, nextDay.getTime() - now.getTime()),
      )
    }

    scheduleNextDaySync()

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [syncFromNativeWidget])

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
      syncFromNativeWidget()
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
  }, [consumePendingRoute, syncFromNativeWidget])

  return null
}
