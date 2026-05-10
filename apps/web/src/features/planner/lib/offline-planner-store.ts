import {
  generateUuidV7,
  type NewProjectInput,
  type NewTaskInput,
  type ProjectRecord,
  type ProjectUpdateInput,
  type TaskRecord,
  type TaskScheduleInput,
  type TaskStatus,
  type TaskTemplateRecord,
  type TaskUpdateInput,
} from '@planner/contracts'
import Dexie, { type Table } from 'dexie'

export type PlannerOfflineMutationStatus =
  | 'conflicted'
  | 'failed'
  | 'pending'
  | 'syncing'

interface PlannerCachedTaskRow {
  key: string
  task: TaskRecord
  taskId: string
  updatedAt: string
  workspaceId: string
}

interface PlannerCachedProjectRow {
  key: string
  project: ProjectRecord
  projectId: string
  updatedAt: string
  workspaceId: string
}

interface PlannerCachedTaskTemplateRow {
  key: string
  template: TaskTemplateRecord
  templateId: string
  updatedAt: string
  workspaceId: string
}

interface PlannerSyncMetadataRow {
  key: string
  updatedAt: string
  value: number
  workspaceId: string
}

interface PlannerOfflineMutationBase {
  actorUserId: string
  attemptCount: number
  conflictActualVersion: number | null
  conflictExpectedVersion: number | null
  createdAt: string
  id: string
  lastError: string | null
  status: PlannerOfflineMutationStatus
  updatedAt: string
  workspaceId: string
}

export type PlannerOfflineMutationRecord =
  | (PlannerOfflineMutationBase & {
      input: NewProjectInput
      projectId: string
      type: 'project.create'
    })
  | (PlannerOfflineMutationBase & {
      input: ProjectUpdateInput
      projectId: string
      type: 'project.update'
    })
  | (PlannerOfflineMutationBase & {
      input: NewTaskInput
      taskId: string
      type: 'task.create'
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
      input: NewProjectInput
      projectId: string
      type: 'project.create'
      workspaceId: string
    }
  | {
      actorUserId: string
      input: ProjectUpdateInput
      projectId: string
      type: 'project.update'
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

const RETRYABLE_QUEUE_STATUSES: PlannerOfflineMutationStatus[] = [
  'failed',
  'pending',
  'syncing',
]
export const PLANNER_OFFLINE_DATABASE_NAME = 'planner-offline'
export const PLANNER_OFFLINE_SCHEMA_VERSION = 3

class PlannerOfflineDatabase extends Dexie {
  cachedProjects!: Table<PlannerCachedProjectRow, string>
  cachedTaskTemplates!: Table<PlannerCachedTaskTemplateRow, string>
  cachedTasks!: Table<PlannerCachedTaskRow, string>
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
    this.version(PLANNER_OFFLINE_SCHEMA_VERSION).stores({
      cachedProjects: 'key, workspaceId, projectId, updatedAt',
      cachedTaskTemplates: 'key, workspaceId, templateId, updatedAt',
      cachedTasks: 'key, workspaceId, taskId, updatedAt',
      mutationQueue: 'id, workspaceId, status, createdAt, updatedAt',
      syncMetadata: 'key, workspaceId, updatedAt',
    })
  }
}

let database: PlannerOfflineDatabase | null = null

export function isPlannerOfflineStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

export async function resetPlannerOfflineDatabaseForTests(): Promise<void> {
  database?.close()
  database = null

  if (isPlannerOfflineStorageAvailable()) {
    await Dexie.delete(PLANNER_OFFLINE_DATABASE_NAME)
  }
}

export async function loadCachedTaskRecords(
  workspaceId: string,
): Promise<TaskRecord[]> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return []
  }

  const rows = await db.cachedTasks
    .where('workspaceId')
    .equals(workspaceId)
    .toArray()

  return rows.map((row) => row.task)
}

export async function loadCachedProjectRecords(
  workspaceId: string,
): Promise<ProjectRecord[]> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return []
  }

  const rows = await db.cachedProjects
    .where('workspaceId')
    .equals(workspaceId)
    .toArray()

  return rows.map((row) => row.project)
}

export async function loadCachedTaskTemplateRecords(
  workspaceId: string,
): Promise<TaskTemplateRecord[]> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return []
  }

  const rows = await db.cachedTaskTemplates
    .where('workspaceId')
    .equals(workspaceId)
    .toArray()

  return rows.map((row) => row.template)
}

export async function replaceCachedTaskRecords(
  workspaceId: string,
  tasks: TaskRecord[],
): Promise<void> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return
  }

  const updatedAt = new Date().toISOString()
  const rows = tasks.map(
    (task): PlannerCachedTaskRow => ({
      key: createCachedTaskKey(workspaceId, task.id),
      task,
      taskId: task.id,
      updatedAt,
      workspaceId,
    }),
  )

  await db.transaction('rw', db.cachedTasks, async () => {
    await db.cachedTasks.where('workspaceId').equals(workspaceId).delete()

    if (rows.length > 0) {
      await db.cachedTasks.bulkPut(rows)
    }
  })
}

export async function replaceCachedProjectRecords(
  workspaceId: string,
  projects: ProjectRecord[],
): Promise<void> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return
  }

  const updatedAt = new Date().toISOString()
  const rows = projects.map(
    (project): PlannerCachedProjectRow => ({
      key: createCachedProjectKey(workspaceId, project.id),
      project,
      projectId: project.id,
      updatedAt,
      workspaceId,
    }),
  )

  await db.transaction('rw', db.cachedProjects, async () => {
    await db.cachedProjects.where('workspaceId').equals(workspaceId).delete()

    if (rows.length > 0) {
      await db.cachedProjects.bulkPut(rows)
    }
  })
}

export async function replaceCachedTaskTemplateRecords(
  workspaceId: string,
  templates: TaskTemplateRecord[],
): Promise<void> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return
  }

  const updatedAt = new Date().toISOString()
  const rows = templates.map(
    (template): PlannerCachedTaskTemplateRow => ({
      key: createCachedTaskTemplateKey(workspaceId, template.id),
      template,
      templateId: template.id,
      updatedAt,
      workspaceId,
    }),
  )

  await db.transaction('rw', db.cachedTaskTemplates, async () => {
    await db.cachedTaskTemplates
      .where('workspaceId')
      .equals(workspaceId)
      .delete()

    if (rows.length > 0) {
      await db.cachedTaskTemplates.bulkPut(rows)
    }
  })
}

export async function upsertCachedTaskRecord(
  workspaceId: string,
  task: TaskRecord,
): Promise<void> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return
  }

  await db.cachedTasks.put({
    key: createCachedTaskKey(workspaceId, task.id),
    task,
    taskId: task.id,
    updatedAt: new Date().toISOString(),
    workspaceId,
  })
}

export async function upsertCachedProjectRecord(
  workspaceId: string,
  project: ProjectRecord,
): Promise<void> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return
  }

  await db.cachedProjects.put({
    key: createCachedProjectKey(workspaceId, project.id),
    project,
    projectId: project.id,
    updatedAt: new Date().toISOString(),
    workspaceId,
  })
}

export async function removeCachedTaskRecord(
  workspaceId: string,
  taskId: string,
): Promise<void> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return
  }

  await db.cachedTasks.delete(createCachedTaskKey(workspaceId, taskId))
}

export async function enqueuePlannerOfflineMutation(
  input: PlannerOfflineMutationInput,
): Promise<PlannerOfflineMutationRecord | null> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return null
  }

  const now = new Date().toISOString()
  const mutation = {
    ...input,
    attemptCount: 0,
    conflictActualVersion: null,
    conflictExpectedVersion: null,
    createdAt: now,
    id: generateUuidV7(),
    lastError: null,
    status: 'pending',
    updatedAt: now,
  } satisfies PlannerOfflineMutationRecord

  await db.mutationQueue.put(mutation)

  return mutation
}

export async function listRetryablePlannerOfflineMutations(
  workspaceId: string,
): Promise<PlannerOfflineMutationRecord[]> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return []
  }

  const rows = await db.mutationQueue
    .where('workspaceId')
    .equals(workspaceId)
    .filter((mutation) => RETRYABLE_QUEUE_STATUSES.includes(mutation.status))
    .toArray()

  return rows.sort(compareOfflineMutations)
}

export async function countRetryablePlannerOfflineMutations(
  workspaceId: string,
): Promise<number> {
  const mutations = await listRetryablePlannerOfflineMutations(workspaceId)

  return mutations.length
}

export async function countConflictedPlannerOfflineMutations(
  workspaceId: string,
): Promise<number> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return 0
  }

  return db.mutationQueue
    .where('workspaceId')
    .equals(workspaceId)
    .filter((mutation) => mutation.status === 'conflicted')
    .count()
}

export async function getLastTaskEventId(workspaceId: string): Promise<number> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return 0
  }

  const row = await db.syncMetadata.get(createSyncMetadataKey(workspaceId))

  return row?.value ?? 0
}

export async function setLastTaskEventId(
  workspaceId: string,
  value: number,
): Promise<void> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return
  }

  await db.syncMetadata.put({
    key: createSyncMetadataKey(workspaceId),
    updatedAt: new Date().toISOString(),
    value,
    workspaceId,
  })
}

export async function markPlannerOfflineMutationSyncing(
  mutationId: string,
): Promise<void> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return
  }

  const mutation = await db.mutationQueue.get(mutationId)

  if (!mutation) {
    return
  }

  await db.mutationQueue.update(mutationId, {
    attemptCount: mutation.attemptCount + 1,
    conflictActualVersion: null,
    conflictExpectedVersion: null,
    lastError: null,
    status: 'syncing',
    updatedAt: new Date().toISOString(),
  })
}

export async function completePlannerOfflineMutation(
  mutationId: string,
): Promise<void> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return
  }

  await db.mutationQueue.delete(mutationId)
}

export async function markPlannerOfflineMutationFailed(
  mutationId: string,
  errorMessage: string,
): Promise<void> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return
  }

  await db.mutationQueue.update(mutationId, {
    lastError: errorMessage,
    status: 'failed',
    updatedAt: new Date().toISOString(),
  })
}

export async function markPlannerOfflineMutationConflicted(
  mutationId: string,
  details: {
    actualVersion: number | null
    expectedVersion: number | null
    message: string
  },
): Promise<void> {
  const db = getPlannerOfflineDatabase()

  if (!db) {
    return
  }

  await db.mutationQueue.update(mutationId, {
    conflictActualVersion: details.actualVersion,
    conflictExpectedVersion: details.expectedVersion,
    lastError: details.message,
    status: 'conflicted',
    updatedAt: new Date().toISOString(),
  })
}

function getPlannerOfflineDatabase(): PlannerOfflineDatabase | null {
  if (!isPlannerOfflineStorageAvailable()) {
    return null
  }

  database ??= new PlannerOfflineDatabase()

  return database
}

function createCachedTaskKey(workspaceId: string, taskId: string): string {
  return `${workspaceId}:${taskId}`
}

function createCachedProjectKey(
  workspaceId: string,
  projectId: string,
): string {
  return `${workspaceId}:${projectId}`
}

function createCachedTaskTemplateKey(
  workspaceId: string,
  templateId: string,
): string {
  return `${workspaceId}:${templateId}`
}

function createSyncMetadataKey(workspaceId: string): string {
  return `${workspaceId}:task-events:last-id`
}

function compareOfflineMutations(
  left: PlannerOfflineMutationRecord,
  right: PlannerOfflineMutationRecord,
): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1
  }

  if (left.id === right.id) {
    return 0
  }

  return left.id < right.id ? -1 : 1
}
