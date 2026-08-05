import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router'

import type { TaskComposerDraft } from '@/features/task-create'

export function useWidgetTaskComposerDraft(
  todayKey: string,
): TaskComposerDraft | null {
  const [searchParams, setSearchParams] = useSearchParams()
  const createTaskRequestId = searchParams.get('createTask')

  useEffect(() => {
    if (!createTaskRequestId) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('createTask')
    setSearchParams(nextSearchParams, { replace: true })
  }, [createTaskRequestId, searchParams, setSearchParams])

  return useMemo(
    () =>
      createTaskRequestId
        ? {
            plannedDate: todayKey,
            requestId: createTaskRequestId,
          }
        : null,
    [createTaskRequestId, todayKey],
  )
}
