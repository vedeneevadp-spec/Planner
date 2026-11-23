import type { TaskRecord } from '@planner/contracts'

import type { PlannerOfflineMutationRecord } from './offline-planner-schema'

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
