import type { TaskCursorListResponse, TaskRecord } from '@planner/contracts'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import type { PlannerOfflineMutationRecord } from '../lib/offline-planner-store'
import type { PlannerTaskQueryKey } from './planner-queries'

type TaskPageCache =
  TaskCursorListResponse | InfiniteData<TaskCursorListResponse>

export function mergePlannerTaskSnapshot(
  records: TaskRecord[],
  localRecords: readonly TaskRecord[],
  mutations: readonly PlannerOfflineMutationRecord[],
): TaskRecord[] {
  const localById = new Map(localRecords.map((record) => [record.id, record]))
  const pendingIds = new Set<string>()
  const deletedIds = new Set<string>()
  const conflictedIds = new Set<string>()

  for (const mutation of mutations) {
    if (!('taskId' in mutation)) continue
    const targets =
      mutation.status === 'conflicted' ? conflictedIds : pendingIds
    targets.add(mutation.taskId)
    if (mutation.type === 'task.next-stage') targets.add(mutation.nextTaskId)
    if (mutation.type === 'task.delete' && mutation.status !== 'conflicted') {
      deletedIds.add(mutation.taskId)
    }
  }

  const snapshot = records
    .filter(
      (record) => !deletedIds.has(record.id) || conflictedIds.has(record.id),
    )
    .map((record) => {
      const local = localById.get(record.id)
      // A refetch can finish while a queued command is still being sent, or
      // carry a version older than an acknowledgement already in the cache.
      // Rejected commands must still yield to the authoritative server state.
      return local &&
        !conflictedIds.has(record.id) &&
        (pendingIds.has(record.id) || local.version > record.version)
        ? local
        : record
    })
  const snapshotIds = new Set(snapshot.map((record) => record.id))

  for (const taskId of pendingIds) {
    const local = localById.get(taskId)
    if (
      local &&
      !snapshotIds.has(taskId) &&
      !deletedIds.has(taskId) &&
      !conflictedIds.has(taskId)
    ) {
      snapshot.push(local)
    }
  }

  return snapshot
}

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
