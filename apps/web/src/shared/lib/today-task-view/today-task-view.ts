import { useEffect, useSyncExternalStore } from 'react'

export type TodayTaskView = 'cards' | 'list'

export const TODAY_TASK_VIEW_SEARCH_PARAM = 'taskView'

const TODAY_TASK_VIEW_STORAGE_KEY = 'planner.today.taskView.v1'
const DEFAULT_TODAY_TASK_VIEW: TodayTaskView = 'cards'
const listeners = new Set<() => void>()

export function getStoredTodayTaskView(): TodayTaskView {
  if (typeof window === 'undefined') {
    return DEFAULT_TODAY_TASK_VIEW
  }

  try {
    return (
      parseTodayTaskView(
        window.localStorage.getItem(TODAY_TASK_VIEW_STORAGE_KEY),
      ) ?? DEFAULT_TODAY_TASK_VIEW
    )
  } catch {
    return DEFAULT_TODAY_TASK_VIEW
  }
}

export function setStoredTodayTaskView(taskView: TodayTaskView): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (getStoredTodayTaskView() === taskView) {
      return
    }

    window.localStorage.setItem(TODAY_TASK_VIEW_STORAGE_KEY, taskView)
  } catch {
    return
  }

  emitTodayTaskViewChange()
}

export function getTodayTaskViewFromSearchParams(
  searchParams: URLSearchParams,
): TodayTaskView | null {
  return parseTodayTaskView(searchParams.get(TODAY_TASK_VIEW_SEARCH_PARAM))
}

export function useTodayTaskView(
  searchParams: URLSearchParams | null,
): TodayTaskView {
  const storedTaskView = useSyncExternalStore(
    subscribeTodayTaskView,
    getStoredTodayTaskView,
    () => DEFAULT_TODAY_TASK_VIEW,
  )
  const queryTaskView = searchParams
    ? getTodayTaskViewFromSearchParams(searchParams)
    : null

  useEffect(() => {
    if (queryTaskView) {
      setStoredTodayTaskView(queryTaskView)
    }
  }, [queryTaskView])

  return queryTaskView ?? storedTaskView
}

function parseTodayTaskView(value: string | null): TodayTaskView | null {
  return value === 'cards' || value === 'list' ? value : null
}

function subscribeTodayTaskView(listener: () => void): () => void {
  listeners.add(listener)

  function handleStorage(event: StorageEvent) {
    if (event.key === TODAY_TASK_VIEW_STORAGE_KEY || event.key === null) {
      listener()
    }
  }

  window.addEventListener('storage', handleStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', handleStorage)
  }
}

function emitTodayTaskViewChange(): void {
  for (const listener of listeners) {
    listener()
  }
}
