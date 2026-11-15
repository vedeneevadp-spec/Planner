import {
  type LifeSphereRecord,
  type LifeSphereUpdateInput,
  type NewLifeSphereInput,
  type NewTaskInput,
  type TaskNextStageInput,
  type TaskRecord,
  type TaskScheduleInput,
  type TaskStatus,
  type TaskTemplateRecord,
  type TaskUpdateInput,
} from '@planner/contracts'
import Dexie, { type Table } from 'dexie'

export type PlannerOfflineMutationStatus =
  'conflicted' | 'failed' | 'pending' | 'syncing'

export interface PlannerCachedTaskRow {
  key: string
  task: TaskRecord
  taskId: string
  updatedAt: string
  workspaceId: string
}

export interface PlannerCachedLifeSphereRow {
  key: string
  sphere: LifeSphereRecord
  sphereId: string
  updatedAt: string
  workspaceId: string
}

export interface PlannerCachedTaskTemplateRow {
  key: string
  template: TaskTemplateRecord
  templateId: string
  updatedAt: string
  workspaceId: string
}

export interface PlannerSyncMetadataRow {
  key: string
  updatedAt: string
  value: number
  workspaceId: string
}

export type PlannerDataSyncScope = 'life-spheres' | 'task-templates' | 'tasks'

export type PlannerWorkspaceWriteScope =
  PlannerDataSyncScope | 'mutation-queue' | 'sync-metadata'

export const PLANNER_DATA_SYNC_SCOPES: readonly PlannerDataSyncScope[] = [
  'life-spheres',
  'task-templates',
  'tasks',
]

export interface PlannerDataSyncMetadataRow {
  key: string
  lastSuccessfulSyncAt: string
  scope: PlannerDataSyncScope
  workspaceId: string
}

export interface PlannerOfflineMutationBase {
  writeEpoch?: string
  actorUserId: string
  attemptCount: number
  conflictActualVersion: number | null
  conflictExpectedVersion: number | null
  conflictCode?: string | null
  createdAt: string
  id: string
  lastError: string | null
  status: PlannerOfflineMutationStatus
  updatedAt: string
  workspaceId: string
}

export type PlannerOfflineMutationRecord =
  | (PlannerOfflineMutationBase & {
      input: NewLifeSphereInput
      sphereId: string
      type: 'lifeSphere.create'
    })
  | (PlannerOfflineMutationBase & {
      input: LifeSphereUpdateInput
      sphereId: string
      type: 'lifeSphere.update'
    })
  | (PlannerOfflineMutationBase & {
      input: NewTaskInput
      taskId: string
      type: 'task.create'
    })
  | (PlannerOfflineMutationBase & {
      expectedVersion: number
      input: TaskNextStageInput
      nextTaskId: string
      taskId: string
      type: 'task.next-stage'
    })
  | (PlannerOfflineMutationBase & {
      expectedVersion: number
      input: TaskUpdateInput
      taskId: string
      type: 'task.update'
    })
  | (PlannerOfflineMutationBase & {
      expectedVersion: number
      statusValue: TaskStatus
      taskId: string
      type: 'task.status.update'
    })
  | (PlannerOfflineMutationBase & {
      expectedVersion: number
      schedule: TaskScheduleInput
      taskId: string
      type: 'task.schedule.update'
    })
  | (PlannerOfflineMutationBase & {
      expectedVersion: number
      taskId: string
      type: 'task.delete'
    })

export type PlannerOfflineMutationInput =
  | {
      actorUserId: string
      input: NewLifeSphereInput
      sphereId: string
      type: 'lifeSphere.create'
      workspaceId: string
    }
  | {
      actorUserId: string
      input: LifeSphereUpdateInput
      sphereId: string
      type: 'lifeSphere.update'
      workspaceId: string
    }
  | {
      actorUserId: string
      input: NewTaskInput
      taskId: string
      type: 'task.create'
      workspaceId: string
    }
  | {
      actorUserId: string
      expectedVersion: number
      input: TaskNextStageInput
      nextTaskId: string
      taskId: string
      type: 'task.next-stage'
      workspaceId: string
    }
  | {
      actorUserId: string
      expectedVersion: number
      input: TaskUpdateInput
      taskId: string
      type: 'task.update'
      workspaceId: string
    }
  | {
      actorUserId: string
      expectedVersion: number
      statusValue: TaskStatus
      taskId: string
      type: 'task.status.update'
      workspaceId: string
    }
  | {
      actorUserId: string
      expectedVersion: number
      schedule: TaskScheduleInput
      taskId: string
      type: 'task.schedule.update'
      workspaceId: string
    }
  | {
      actorUserId: string
      expectedVersion: number
      taskId: string
      type: 'task.delete'
      workspaceId: string
    }

export interface EnqueuePlannerOfflineMutationOptions {
  optimisticTask?: TaskRecord | undefined
  optimisticTasks?: readonly TaskRecord[] | undefined
  removeCachedTaskId?: string | undefined
}

export const RETRYABLE_QUEUE_STATUSES: PlannerOfflineMutationStatus[] = [
  'failed',
  'pending',
  'syncing',
]

export const PLANNER_OFFLINE_DATABASE_NAME = 'planner-offline'

export const PLANNER_OFFLINE_SCHEMA_VERSION = 5

export const PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY =
  'planner.plannerOfflineLifecycle'

export const PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX = `${PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY}:`

export interface PlannerOfflineLifecycleState {
  pendingPurges: Record<string, number>
  writeGenerations: Record<string, number>
}

export interface PlannerOfflineWorkspaceLifecycleState {
  pendingPurgeGeneration: number | null
  writeGeneration: number
}

export class PlannerOfflineDatabase extends Dexie {
  cachedLifeSpheres!: Table<PlannerCachedLifeSphereRow, string>
  cachedTaskTemplates!: Table<PlannerCachedTaskTemplateRow, string>
  cachedTasks!: Table<PlannerCachedTaskRow, string>
  dataSyncMetadata!: Table<PlannerDataSyncMetadataRow, string>
  mutationQueue!: Table<PlannerOfflineMutationRecord, string>
  syncMetadata!: Table<PlannerSyncMetadataRow, string>

  constructor() {
    super(PLANNER_OFFLINE_DATABASE_NAME)

    this.version(1).stores({
      cachedTasks: 'key, workspaceId, taskId, updatedAt',
      mutationQueue: 'id, workspaceId, status, createdAt, updatedAt',
      syncMetadata: 'key, workspaceId, updatedAt',
    })
    this.version(2).stores({
      cachedProjects: 'key, workspaceId, projectId, updatedAt',
      cachedTasks: 'key, workspaceId, taskId, updatedAt',
      mutationQueue: 'id, workspaceId, status, createdAt, updatedAt',
      syncMetadata: 'key, workspaceId, updatedAt',
    })
    this.version(4).stores({
      cachedLifeSpheres: 'key, workspaceId, sphereId, updatedAt',
      cachedTaskTemplates: 'key, workspaceId, templateId, updatedAt',
      cachedTasks: 'key, workspaceId, taskId, updatedAt',
      mutationQueue: 'id, workspaceId, status, createdAt, updatedAt',
      syncMetadata: 'key, workspaceId, updatedAt',
    })
    this.version(PLANNER_OFFLINE_SCHEMA_VERSION).stores({
      cachedLifeSpheres: 'key, workspaceId, sphereId, updatedAt',
      cachedTaskTemplates: 'key, workspaceId, templateId, updatedAt',
      cachedTasks: 'key, workspaceId, taskId, updatedAt',
      dataSyncMetadata:
        'key, workspaceId, scope, lastSuccessfulSyncAt, [workspaceId+scope]',
      mutationQueue: 'id, workspaceId, status, createdAt, updatedAt',
      syncMetadata: 'key, workspaceId, updatedAt',
    })
  }
}
