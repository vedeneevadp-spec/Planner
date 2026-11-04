import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router'

import type { TaskComposerDraft } from '@/features/task-create'

export function useWidgetTaskComposerDraft(
  enabled = true,
): TaskComposerDraft | null {
  const [searchParams, setSearchParams] = useSearchParams()
  const createTaskRequestId = searchParams.get('createTask')

  useEffect(() => {
    if (!enabled || !createTaskRequestId) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('createTask')
    setSearchParams(nextSearchParams, { replace: true })
  }, [createTaskRequestId, enabled, searchParams, setSearchParams])

  return useMemo(
    () =>
      enabled && createTaskRequestId
        ? {
            plannedDate: null,
            requestId: createTaskRequestId,
          }
        : null,
    [createTaskRequestId, enabled],
  )
}
