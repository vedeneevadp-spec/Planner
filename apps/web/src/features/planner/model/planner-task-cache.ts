import type { TaskCursorListResponse, TaskRecord } from '@planner/contracts'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import type { PlannerTaskQueryKey } from './planner-queries'

type TaskPageCache =
  TaskCursorListResponse | InfiniteData<TaskCursorListResponse>

function mapPages(
  data: TaskPageCache,
  update: (page: TaskCursorListResponse) => TaskCursorListResponse,
): TaskPageCache {
  return 'pages' in data
    ? { ...data, pages: data.pages.map(update) }
    : update(data)
}

export function mergeTaskPageWithSnapshot(
  page: TaskCursorListResponse,
  snapshot: readonly TaskRecord[],
): TaskCursorListResponse {
  const records = new Map(snapshot.map((record) => [record.id, record]))
  return {
    ...page,
    items: page.items.map((record) => {
      const current = records.get(record.id)
      return current && current.version >= record.version ? current : record
    }),
  }
}

export function getPlannerCachedTaskRecord(
  queryClient: QueryClient,
  taskQueryKey: PlannerTaskQueryKey,
  taskId: string,
): TaskRecord | undefined {
  let record = queryClient
    .getQueryData<TaskRecord[]>(taskQueryKey)
    ?.find((task) => task.id === taskId && task.workspaceId === taskQueryKey[2])
  for (const [, data] of queryClient.getQueriesData<TaskPageCache>({
    queryKey: [...taskQueryKey, 'cursor'],
  })) {
    if (!data) continue
    const pages = 'pages' in data ? data.pages : [data]
    for (const page of pages) {
      const candidate = page.items.find(
        (task) => task.id === taskId && task.workspaceId === taskQueryKey[2],
      )
      if (candidate && (!record || candidate.version > record.version)) {
        record = candidate
      }
    }
  }
  return record
}

// Keep the snapshot and already loaded pages consistent during optimistic
// changes, queue replay and rollback. Pages retain their own membership/order;
// creation and rollback remain visible through the snapshot until refetch.
export function setPlannerTaskQueryData(
  queryClient: QueryClient,
  taskQueryKey: PlannerTaskQueryKey,
  update: (records: TaskRecord[]) => TaskRecord[],
): void {
  const previous = queryClient.getQueryData<TaskRecord[]>(taskQueryKey) ?? []
  const next = update(previous)
  const previousById = new Map(previous.map((record) => [record.id, record]))
  const nextById = new Map(next.map((record) => [record.id, record]))
  const changed = new Map(
    next
      .filter((record) => previousById.get(record.id) !== record)
      .map((record) => [record.id, record]),
  )
  const removed = new Set(
    previous.filter((record) => !nextById.has(record.id)).map(({ id }) => id),
  )

  queryClient.setQueryData(taskQueryKey, next)
  queryClient.setQueriesData<TaskPageCache>(
    { queryKey: [...taskQueryKey, 'cursor'] },
    (data) =>
      data
        ? mapPages(data, (page) => {
            const items = page.items
              .filter((record) => !removed.has(record.id))
              .map((record) => changed.get(record.id) ?? record)
            return { ...page, items, returnedCount: items.length }
          })
        : data,
  )
}
