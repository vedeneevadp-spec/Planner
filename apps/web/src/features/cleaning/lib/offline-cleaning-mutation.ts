import type {
  CleaningSeedInput,
  CleaningTaskActionInput,
  CleaningTaskHistoryAction,
  CleaningTaskUpdateInput,
  CleaningZoneUpdateInput,
  NewCleaningTaskInput,
  NewCleaningZoneInput,
} from '@planner/contracts'

export type CleaningOfflineMutationStatus =
  'conflicted' | 'failed' | 'pending' | 'syncing'

interface CleaningOfflineMutationBase {
  actorUserId: string
  attemptCount: number
  conflictActualVersion: number | null
  conflictExpectedVersion: number | null
  createdAt: string
  dependsOnOperationIds: string[]
  entityKeys: string[]
  lastError: string | null
  operationId: string
  sequence?: number | undefined
  status: CleaningOfflineMutationStatus
  updatedAt: string
  workspaceId: string
}

export type CleaningOfflineMutationRecord =
  | (CleaningOfflineMutationBase & {
      input: NewCleaningZoneInput & { id: string }
      type: 'zone.create'
      zoneId: string
    })
  | (CleaningOfflineMutationBase & {
      expectedVersion: number
      input: CleaningZoneUpdateInput
      type: 'zone.update'
      zoneId: string
    })
  | (CleaningOfflineMutationBase & {
      expectedTaskVersions: Array<{ taskId: string; version: number }>
      expectedVersion: number
      type: 'zone.delete'
      zoneId: string
    })
  | (CleaningOfflineMutationBase & {
      input: NewCleaningTaskInput & { id: string }
      taskId: string
      type: 'task.create'
    })
  | (CleaningOfflineMutationBase & {
      expectedVersion: number
      input: CleaningTaskUpdateInput
      taskId: string
      type: 'task.update'
    })
  | (CleaningOfflineMutationBase & {
      expectedVersion: number
      taskId: string
      type: 'task.delete'
    })
  | (CleaningOfflineMutationBase & {
      action: CleaningTaskHistoryAction
      expectedStateVersion: number
      expectedTaskVersion: number
      input: CleaningTaskActionInput & {
        date: string
        occurredAt: string
      }
      taskId: string
      type: 'task.action'
    })
  | (CleaningOfflineMutationBase & {
      input: CleaningSeedInput
      type: 'cleaning.seed'
    })

export type CleaningOfflineMutationInput =
  CleaningOfflineMutationRecord extends infer TMutation
    ? TMutation extends CleaningOfflineMutationRecord
      ? Omit<
          TMutation,
          | 'attemptCount'
          | 'conflictActualVersion'
          | 'conflictExpectedVersion'
          | 'createdAt'
          | 'dependsOnOperationIds'
          | 'lastError'
          | 'operationId'
          | 'sequence'
          | 'status'
          | 'updatedAt'
        > & {
          createdAt?: string | undefined
          operationId?: string | undefined
        }
      : never
    : never
