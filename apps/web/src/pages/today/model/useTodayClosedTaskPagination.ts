import { useCallback, useMemo, useState } from 'react'

import type { Task } from '@/entities/task'
import { toPlannerTask, usePlannerTaskInfiniteCursor } from '@/features/planner'

interface UseTodayClosedTaskPaginationInput {
  initialCursor: string | null
  initialReturnedCount: number
  plannerTimeZone: string
  tasks: Task[]
  totalCount: number
}

export function useTodayClosedTaskPagination({
  initialCursor,
  initialReturnedCount,
  plannerTimeZone,
  tasks,
  totalCount,
}: UseTodayClosedTaskPaginationInput) {
  const paginationKey = `${initialCursor ?? 'start'}:${initialReturnedCount}:${totalCount}`
  const [requestedPaginationKey, setRequestedPaginationKey] = useState<
    string | null
  >(null)
  const isStarted = requestedPaginationKey === paginationKey
  const pageLimit = initialCursor
    ? 100
    : Math.min(500, Math.max(100, initialReturnedCount + 100))
  const query = usePlannerTaskInfiniteCursor(
    {
      dateMode: 'relevant',
      direction: 'desc',
      limit: pageLimit,
      scope: 'closed',
    },
    {
      enabled: isStarted,
      initialCursor,
    },
  )
  const pagedRecords = useMemo(
    () =>
      isStarted ? (query.data?.pages.flatMap((page) => page.items) ?? []) : [],
    [isStarted, query.data?.pages],
  )
  const resolvedTotalCount =
    (isStarted ? query.data?.pages.at(-1)?.totalCount : undefined) ?? totalCount
  const mergedTasks = useMemo(() => {
    const tasksById = new Map(
      pagedRecords.map((record) => [
        record.id,
        toPlannerTask(record, plannerTimeZone),
      ]),
    )

    for (const task of tasks) {
      tasksById.set(task.id, task)
    }

    return [...tasksById.values()]
  }, [pagedRecords, plannerTimeZone, tasks])
  const loadedCount = useMemo(() => {
    const initialTaskIds = new Set(tasks.map((task) => task.id))
    const additionalTaskIds = new Set(
      pagedRecords
        .filter((record) => !initialTaskIds.has(record.id))
        .map((record) => record.id),
    )

    return Math.min(
      resolvedTotalCount,
      initialReturnedCount + additionalTaskIds.size,
    )
  }, [initialReturnedCount, pagedRecords, resolvedTotalCount, tasks])
  const hasMore =
    loadedCount < resolvedTotalCount &&
    (!isStarted || query.hasNextPage !== false)
  const loadMore = useCallback(async () => {
    if (!isStarted) {
      setRequestedPaginationKey(paginationKey)
      return
    }

    if (query.isError) {
      await query.refetch()
      return
    }

    await query.fetchNextPage()
  }, [isStarted, paginationKey, query])

  return {
    errorMessage: query.isError
      ? 'Не удалось загрузить продолжение архива.'
      : null,
    hasMore,
    isLoading: isStarted && query.isFetching,
    loadMore,
    loadedCount,
    tasks: mergedTasks,
    totalCount: resolvedTotalCount,
  }
}
