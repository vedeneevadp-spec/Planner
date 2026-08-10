import {
  generateUuidV7,
  type LifeSphereRecord,
  type LifeSphereUpdateInput,
  type NewLifeSphereInput,
  type NewTaskInput,
  type TaskRecord,
  type TaskScheduleInput,
  type TaskStatus,
  type TaskTemplateRecord,
  type TaskUpdateInput,
} from '@planner/contracts'
import Dexie, { type Table } from 'dexie'

export type PlannerOfflineMutationStatus =
  'conflicted' | 'failed' | 'pending' | 'syncing'

export class PlannerOfflinePurgeUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      'Не удалось безопасно очистить локальные данные планировщика. Повторите действие после перезапуска приложения.',
      options,
    )
    this.name = 'PlannerOfflinePurgeUnavailableError'
  }
}

interface PlannerCachedTaskRow {
  key: string
  task: TaskRecord
  taskId: string
  updatedAt: string
  workspaceId: string
}

interface PlannerCachedLifeSphereRow {
  key: string
  sphere: LifeSphereRecord
  sphereId: string
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

export type PlannerDataSyncScope = 'life-spheres' | 'task-templates' | 'tasks'

type PlannerWorkspaceWriteScope =
  PlannerDataSyncScope | 'mutation-queue' | 'sync-metadata'

const PLANNER_DATA_SYNC_SCOPES: readonly PlannerDataSyncScope[] = [
  'life-spheres',
  'task-templates',
  'tasks',
]

interface PlannerDataSyncMetadataRow {
  key: string
  lastSuccessfulSyncAt: string
  scope: PlannerDataSyncScope
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

interface EnqueuePlannerOfflineMutationOptions {
  optimisticTask?: TaskRecord | undefined
  removeCachedTaskId?: string | undefined
}

const RETRYABLE_QUEUE_STATUSES: PlannerOfflineMutationStatus[] = [
  'failed',
  'pending',
  'syncing',
]
export const PLANNER_OFFLINE_DATABASE_NAME = 'planner-offline'
export const PLANNER_OFFLINE_SCHEMA_VERSION = 5
export const PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY =
  'planner.plannerOfflineLifecycle'
export const PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX = `${PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY}:`

interface PlannerOfflineLifecycleState {
  pendingPurges: Record<string, number>
  writeGenerations: Record<string, number>
}

interface PlannerOfflineWorkspaceLifecycleState {
  pendingPurgeGeneration: number | null
  writeGeneration: number
}

class PlannerOfflineDatabase extends Dexie {
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

let database: PlannerOfflineDatabase | null = null
let lifecycleFlush: Promise<void> | null = null
let lifecycleStorageListenerAttached = false
const pendingCacheWrites = new Map<string, Promise<unknown>>()
const workspaceWriteGenerations = new Map<string, number>()
const localPendingPurgeWorkspaces = new Map<string, number>()
const runtimeInvalidatedWorkspaces = new Map<string, number>()
let runtimeLifecycleBaseline = readStoredPlannerOfflineLifecycleState()

export function isPlannerOfflineStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

export function getPlannerOfflineWorkspaceWriteGeneration(
  workspaceId: string,
): number {
  ensurePlannerOfflineLifecycleStorageListener()
  const runtimeGeneration = workspaceWriteGenerations.get(workspaceId) ?? 0
  const persistedGeneration =
    readStoredPlannerOfflineWorkspaceLifecycleState(workspaceId)
      ?.writeGeneration ?? 0
  const generation = Math.max(runtimeGeneration, persistedGeneration)
  const baselineGeneration =
    runtimeLifecycleBaseline.writeGenerations[workspaceId] ?? 0

  if (generation !== runtimeGeneration) {
    workspaceWriteGenerations.set(workspaceId, generation)
  }

  if (persistedGeneration > baselineGeneration) {
    runtimeInvalidatedWorkspaces.set(workspaceId, persistedGeneration)
  }

  return generation
}

export function isPlannerOfflineWorkspaceWriteGenerationCurrent(
  workspaceId: string,
  expectedWriteGeneration: number,
): boolean {
  return (
    expectedWriteGeneration ===
      getPlannerOfflineWorkspaceWriteGeneration(workspaceId) &&
    !isPlannerOfflineWorkspaceRuntimeInvalidated(workspaceId)
  )
}

export async function resetPlannerOfflineDatabaseForTests(): Promise<void> {
  database?.close()
  database = null
  lifecycleFlush = null
  pendingCacheWrites.clear()
  workspaceWriteGenerations.clear()
  localPendingPurgeWorkspaces.clear()
  runtimeInvalidatedWorkspaces.clear()

  if (isPlannerOfflineStorageAvailable()) {
    await Dexie.delete(PLANNER_OFFLINE_DATABASE_NAME)
  }

  removeStoredPlannerOfflineLifecycleState()
  runtimeLifecycleBaseline = readStoredPlannerOfflineLifecycleState()
}

export function resetPlannerOfflineRuntimeForTests(): void {
  database?.close()
  database = null
  lifecycleFlush = null
  pendingCacheWrites.clear()
  workspaceWriteGenerations.clear()
  localPendingPurgeWorkspaces.clear()
  runtimeInvalidatedWorkspaces.clear()
  runtimeLifecycleBaseline = readStoredPlannerOfflineLifecycleState()
}

export async function clearPlannerOfflineWorkspaceData(
  workspaceId: string,
): Promise<void> {
  let generation = getPlannerOfflineWorkspaceWriteGeneration(workspaceId) + 1
  let markerPersisted = beginPlannerOfflineWorkspacePurge(
    workspaceId,
    generation,
  )
  await waitForPlannerWorkspaceWrites(workspaceId)
  const db = getPlannerOfflineLifecycleDatabase()

  if (!db) {
    throw new PlannerOfflinePurgeUnavailableError()
  }

  try {
    const databaseGeneration =
      (
        await db.syncMetadata.get(
          createWorkspaceLifecycleMetadataKey(workspaceId),
        )
      )?.value ?? 0

    if (databaseGeneration >= generation) {
      generation = databaseGeneration + 1
      markerPersisted = beginPlannerOfflineWorkspacePurge(
        workspaceId,
        generation,
      )
      await waitForPlannerWorkspaceWrites(workspaceId)
    }

    await purgePlannerOfflineWorkspaces(db, { [workspaceId]: generation })

    if (
      !markerPersisted ||
      !completePlannerOfflineWorkspacePurges({ [workspaceId]: generation })
    ) {
      throw new PlannerOfflinePurgeUnavailableError()
    }
  } catch (error) {
    if (error instanceof PlannerOfflinePurgeUnavailableError) {
      throw error
    }

    throw new PlannerOfflinePurgeUnavailableError({ cause: error })
  }
}

export async function loadCachedTaskRecords(
  workspaceId: string,
): Promise<TaskRecord[]> {
  const readGeneration = getPlannerOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return []
  }

  const rows = await db.cachedTasks
    .where('workspaceId')
    .equals(workspaceId)
    .toArray()

  if (
    !isPlannerOfflineWorkspaceWriteGenerationCurrent(
      workspaceId,
      readGeneration,
    )
  ) {
    return []
  }

  return rows.map((row) => row.task)
}

export async function loadCachedLifeSphereRecords(
  workspaceId: string,
): Promise<LifeSphereRecord[]> {
  const readGeneration = getPlannerOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return []
  }

  const rows = await db.cachedLifeSpheres
    .where('workspaceId')
    .equals(workspaceId)
    .toArray()

  if (
    !isPlannerOfflineWorkspaceWriteGenerationCurrent(
      workspaceId,
      readGeneration,
    )
  ) {
    return []
  }

  return rows.map((row) => row.sphere)
}

export async function loadCachedTaskTemplateRecords(
  workspaceId: string,
): Promise<TaskTemplateRecord[]> {
  const readGeneration = getPlannerOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return []
  }

  const rows = await db.cachedTaskTemplates
    .where('workspaceId')
    .equals(workspaceId)
    .toArray()

  if (
    !isPlannerOfflineWorkspaceWriteGenerationCurrent(
      workspaceId,
      readGeneration,
    )
  ) {
    return []
  }

  return rows.map((row) => row.template)
}

export async function getPlannerDataLastSuccessfulSyncAt(
  workspaceId: string,
  scope?: PlannerDataSyncScope,
): Promise<string | null> {
  const readGeneration = getPlannerOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return null
  }

  const rows = scope
    ? await db.dataSyncMetadata
        .where('[workspaceId+scope]')
        .equals([workspaceId, scope])
        .toArray()
    : await db.dataSyncMetadata
        .where('workspaceId')
        .equals(workspaceId)
        .toArray()

  if (
    !isPlannerOfflineWorkspaceWriteGenerationCurrent(
      workspaceId,
      readGeneration,
    )
  ) {
    return null
  }

  if (
    rows.length === 0 ||
    (!scope &&
      new Set(rows.map((row) => row.scope)).size !==
        PLANNER_DATA_SYNC_SCOPES.length)
  ) {
    return null
  }

  return rows.reduce(
    (oldest, row) =>
      row.lastSuccessfulSyncAt < oldest ? row.lastSuccessfulSyncAt : oldest,
    rows[0]!.lastSuccessfulSyncAt,
  )
}

export async function setPlannerDataLastSuccessfulSyncAt(
  workspaceId: string,
  scope: PlannerDataSyncScope,
  lastSuccessfulSyncAt = new Date().toISOString(),
  expectedWriteGeneration = getPlannerOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<void> {
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return
  }

  await runPlannerCacheWrite(
    db,
    workspaceId,
    scope,
    expectedWriteGeneration,
    [db.dataSyncMetadata],
    () =>
      putPlannerDataSyncMetadata(db, workspaceId, scope, lastSuccessfulSyncAt),
  )
}

export async function replaceCachedTaskRecords(
  workspaceId: string,
  tasks: TaskRecord[],
  expectedWriteGeneration = getPlannerOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<void> {
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return
  }

  const updatedAt = new Date().toISOString()
  const rows = tasks.map((task): PlannerCachedTaskRow => ({
    key: createCachedTaskKey(workspaceId, task.id),
    task,
    taskId: task.id,
    updatedAt,
    workspaceId,
  }))

  await runPlannerCacheWrite(
    db,
    workspaceId,
    'tasks',
    expectedWriteGeneration,
    [db.cachedTasks],
    async () => {
      await db.cachedTasks.where('workspaceId').equals(workspaceId).delete()

      if (rows.length > 0) {
        await db.cachedTasks.bulkPut(rows)
      }
    },
  )
}

export async function replaceCachedTaskRecordsFromServer(
  workspaceId: string,
  tasks: TaskRecord[],
  lastSuccessfulSyncAt = new Date().toISOString(),
  expectedWriteGeneration = getPlannerOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<void> {
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return
  }

  const rows = tasks.map((task): PlannerCachedTaskRow => ({
    key: createCachedTaskKey(workspaceId, task.id),
    task,
    taskId: task.id,
    updatedAt: lastSuccessfulSyncAt,
    workspaceId,
  }))

  await runPlannerCacheWrite(
    db,
    workspaceId,
    'tasks',
    expectedWriteGeneration,
    [db.cachedTasks, db.dataSyncMetadata],
    async () => {
      await db.cachedTasks.where('workspaceId').equals(workspaceId).delete()

      if (rows.length > 0) {
        await db.cachedTasks.bulkPut(rows)
      }

      await putPlannerDataSyncMetadata(
        db,
        workspaceId,
        'tasks',
        lastSuccessfulSyncAt,
      )
    },
  )
}

export async function replaceCachedLifeSphereRecords(
  workspaceId: string,
  spheres: LifeSphereRecord[],
  expectedWriteGeneration = getPlannerOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<void> {
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return
  }

  const updatedAt = new Date().toISOString()
  const rows = spheres.map((sphere): PlannerCachedLifeSphereRow => ({
    key: createCachedLifeSphereKey(workspaceId, sphere.id),
    sphere,
    sphereId: sphere.id,
    updatedAt,
    workspaceId,
  }))

  await runPlannerCacheWrite(
    db,
    workspaceId,
    'life-spheres',
    expectedWriteGeneration,
    [db.cachedLifeSpheres],
    async () => {
      await db.cachedLifeSpheres
        .where('workspaceId')
        .equals(workspaceId)
        .delete()

      if (rows.length > 0) {
        await db.cachedLifeSpheres.bulkPut(rows)
      }
    },
  )
}

export async function replaceCachedLifeSphereRecordsFromServer(
  workspaceId: string,
  spheres: LifeSphereRecord[],
  lastSuccessfulSyncAt = new Date().toISOString(),
  expectedWriteGeneration = getPlannerOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<void> {
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return
  }

  const rows = spheres.map((sphere): PlannerCachedLifeSphereRow => ({
    key: createCachedLifeSphereKey(workspaceId, sphere.id),
    sphere,
    sphereId: sphere.id,
    updatedAt: lastSuccessfulSyncAt,
    workspaceId,
  }))

  await runPlannerCacheWrite(
    db,
    workspaceId,
    'life-spheres',
    expectedWriteGeneration,
    [db.cachedLifeSpheres, db.dataSyncMetadata],
    async () => {
      await db.cachedLifeSpheres
        .where('workspaceId')
        .equals(workspaceId)
        .delete()

      if (rows.length > 0) {
        await db.cachedLifeSpheres.bulkPut(rows)
      }

      await putPlannerDataSyncMetadata(
        db,
        workspaceId,
        'life-spheres',
        lastSuccessfulSyncAt,
      )
    },
  )
}

export async function replaceCachedTaskTemplateRecords(
  workspaceId: string,
  templates: TaskTemplateRecord[],
  expectedWriteGeneration = getPlannerOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<void> {
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return
  }

  const updatedAt = new Date().toISOString()
  const rows = templates.map((template): PlannerCachedTaskTemplateRow => ({
    key: createCachedTaskTemplateKey(workspaceId, template.id),
    template,
    templateId: template.id,
    updatedAt,
    workspaceId,
  }))

  await runPlannerCacheWrite(
    db,
    workspaceId,
    'task-templates',
    expectedWriteGeneration,
    [db.cachedTaskTemplates],
    async () => {
      await db.cachedTaskTemplates
        .where('workspaceId')
        .equals(workspaceId)
        .delete()

      if (rows.length > 0) {
        await db.cachedTaskTemplates.bulkPut(rows)
      }
    },
  )
}

export async function replaceCachedTaskTemplateRecordsFromServer(
  workspaceId: string,
  templates: TaskTemplateRecord[],
  lastSuccessfulSyncAt = new Date().toISOString(),
  expectedWriteGeneration = getPlannerOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<void> {
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return
  }

  const rows = templates.map((template): PlannerCachedTaskTemplateRow => ({
    key: createCachedTaskTemplateKey(workspaceId, template.id),
    template,
    templateId: template.id,
    updatedAt: lastSuccessfulSyncAt,
    workspaceId,
  }))

  await runPlannerCacheWrite(
    db,
    workspaceId,
    'task-templates',
    expectedWriteGeneration,
    [db.cachedTaskTemplates, db.dataSyncMetadata],
    async () => {
      await db.cachedTaskTemplates
        .where('workspaceId')
        .equals(workspaceId)
        .delete()

      if (rows.length > 0) {
        await db.cachedTaskTemplates.bulkPut(rows)
      }

      await putPlannerDataSyncMetadata(
        db,
        workspaceId,
        'task-templates',
        lastSuccessfulSyncAt,
      )
    },
  )
}

export async function upsertCachedTaskRecord(
  workspaceId: string,
  task: TaskRecord,
  expectedWriteGeneration = getPlannerOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<void> {
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return
  }

  await runPlannerCacheWrite(
    db,
    workspaceId,
    'tasks',
    expectedWriteGeneration,
    [db.cachedTasks],
    () =>
      db.cachedTasks.put({
        key: createCachedTaskKey(workspaceId, task.id),
        task,
        taskId: task.id,
        updatedAt: new Date().toISOString(),
        workspaceId,
      }),
  )
}

export async function upsertCachedLifeSphereRecord(
  workspaceId: string,
  sphere: LifeSphereRecord,
  expectedWriteGeneration = getPlannerOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<void> {
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return
  }

  await runPlannerCacheWrite(
    db,
    workspaceId,
    'life-spheres',
    expectedWriteGeneration,
    [db.cachedLifeSpheres],
    () =>
      db.cachedLifeSpheres.put({
        key: createCachedLifeSphereKey(workspaceId, sphere.id),
        sphere,
        sphereId: sphere.id,
        updatedAt: new Date().toISOString(),
        workspaceId,
      }),
  )
}

export async function removeCachedTaskRecord(
  workspaceId: string,
  taskId: string,
  expectedWriteGeneration = getPlannerOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<void> {
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return
  }

  await runPlannerCacheWrite(
    db,
    workspaceId,
    'tasks',
    expectedWriteGeneration,
    [db.cachedTasks],
    () => db.cachedTasks.delete(createCachedTaskKey(workspaceId, taskId)),
  )
}

export async function enqueuePlannerOfflineMutation(
  input: PlannerOfflineMutationInput,
  options: EnqueuePlannerOfflineMutationOptions = {},
): Promise<PlannerOfflineMutationRecord | null> {
  const expectedWriteGeneration = getPlannerOfflineWorkspaceWriteGeneration(
    input.workspaceId,
  )
  const db = await getPlannerOfflineDatabase(input.workspaceId)

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

  const optimisticTask = options.optimisticTask
  const removeCachedTaskId = options.removeCachedTaskId

  if (
    optimisticTask &&
    (!('taskId' in input) ||
      optimisticTask.id !== input.taskId ||
      optimisticTask.workspaceId !== input.workspaceId)
  ) {
    throw new Error('Optimistic task does not match the queued mutation.')
  }

  if (
    removeCachedTaskId &&
    (!('taskId' in input) || removeCachedTaskId !== input.taskId)
  ) {
    throw new Error('Removed task does not match the queued mutation.')
  }

  if (optimisticTask && removeCachedTaskId) {
    throw new Error(
      'A planner mutation cannot upsert and remove the cached task together.',
    )
  }

  const updatesCachedTask = Boolean(optimisticTask || removeCachedTaskId)

  const stored = await runPlannerCacheWrite(
    db,
    input.workspaceId,
    'mutation-queue',
    expectedWriteGeneration,
    updatesCachedTask ? [db.mutationQueue, db.cachedTasks] : [db.mutationQueue],
    async () => {
      await db.mutationQueue.put(mutation)

      if (optimisticTask) {
        await db.cachedTasks.put({
          key: createCachedTaskKey(input.workspaceId, optimisticTask.id),
          task: optimisticTask,
          taskId: optimisticTask.id,
          updatedAt: now,
          workspaceId: input.workspaceId,
        })
      } else if (removeCachedTaskId) {
        await db.cachedTasks.delete(
          createCachedTaskKey(input.workspaceId, removeCachedTaskId),
        )
      }

      return true
    },
  )

  return stored ? mutation : null
}

export async function listRetryablePlannerOfflineMutations(
  workspaceId: string,
  actorUserId?: string,
  expectedReadGeneration = getPlannerOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<PlannerOfflineMutationRecord[]> {
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return []
  }

  const rows = await db.mutationQueue
    .where('workspaceId')
    .equals(workspaceId)
    .filter(
      (mutation) =>
        (!actorUserId || mutation.actorUserId === actorUserId) &&
        RETRYABLE_QUEUE_STATUSES.includes(mutation.status),
    )
    .toArray()

  if (
    !isPlannerOfflineWorkspaceWriteGenerationCurrent(
      workspaceId,
      expectedReadGeneration,
    )
  ) {
    return []
  }

  return rows.sort(compareOfflineMutations)
}

export async function countRetryablePlannerOfflineMutations(
  workspaceId: string,
  actorUserId?: string,
): Promise<number> {
  const mutations = await listRetryablePlannerOfflineMutations(
    workspaceId,
    actorUserId,
  )

  return mutations.length
}

export async function countConflictedPlannerOfflineMutations(
  workspaceId: string,
  actorUserId?: string,
): Promise<number> {
  const readGeneration = getPlannerOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return 0
  }

  const count = await db.mutationQueue
    .where('workspaceId')
    .equals(workspaceId)
    .filter(
      (mutation) =>
        (!actorUserId || mutation.actorUserId === actorUserId) &&
        mutation.status === 'conflicted',
    )
    .count()

  return isPlannerOfflineWorkspaceWriteGenerationCurrent(
    workspaceId,
    readGeneration,
  )
    ? count
    : 0
}

export async function getLastTaskEventId(workspaceId: string): Promise<number> {
  const readGeneration = getPlannerOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return 0
  }

  const row = await db.syncMetadata.get(createSyncMetadataKey(workspaceId))

  if (
    !isPlannerOfflineWorkspaceWriteGenerationCurrent(
      workspaceId,
      readGeneration,
    )
  ) {
    return 0
  }

  return row?.value ?? 0
}

export async function setLastTaskEventId(
  workspaceId: string,
  value: number,
  expectedWriteGeneration = getPlannerOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<void> {
  const db = await getPlannerOfflineDatabase(workspaceId)

  if (!db) {
    return
  }

  await runPlannerCacheWrite(
    db,
    workspaceId,
    'sync-metadata',
    expectedWriteGeneration,
    [db.syncMetadata],
    () =>
      db.syncMetadata.put({
        key: createSyncMetadataKey(workspaceId),
        updatedAt: new Date().toISOString(),
        value,
        workspaceId,
      }),
  )
}

export async function markPlannerOfflineMutationSyncing(
  mutationId: string,
  expectedWorkspaceId?: string,
  expectedWriteGeneration?: number,
): Promise<void> {
  const db = await getPlannerOfflineDatabase(expectedWorkspaceId)

  if (!db) {
    return
  }

  await runPlannerMutationQueueWrite(
    db,
    mutationId,
    expectedWorkspaceId,
    expectedWriteGeneration,
    (mutation) =>
      db.mutationQueue.update(mutationId, {
        attemptCount: mutation.attemptCount + 1,
        conflictActualVersion: null,
        conflictExpectedVersion: null,
        lastError: null,
        status: 'syncing',
        updatedAt: new Date().toISOString(),
      }),
  )
}

export async function completePlannerOfflineMutation(
  mutationId: string,
  expectedWorkspaceId?: string,
  expectedWriteGeneration?: number,
): Promise<void> {
  const db = await getPlannerOfflineDatabase(expectedWorkspaceId)

  if (!db) {
    return
  }

  await runPlannerMutationQueueWrite(
    db,
    mutationId,
    expectedWorkspaceId,
    expectedWriteGeneration,
    () => db.mutationQueue.delete(mutationId),
  )
}

export async function markPlannerOfflineMutationFailed(
  mutationId: string,
  errorMessage: string,
  expectedWorkspaceId?: string,
  expectedWriteGeneration?: number,
): Promise<void> {
  const db = await getPlannerOfflineDatabase(expectedWorkspaceId)

  if (!db) {
    return
  }

  await runPlannerMutationQueueWrite(
    db,
    mutationId,
    expectedWorkspaceId,
    expectedWriteGeneration,
    () =>
      db.mutationQueue.update(mutationId, {
        lastError: errorMessage,
        status: 'failed',
        updatedAt: new Date().toISOString(),
      }),
  )
}

export async function markPlannerOfflineMutationConflicted(
  mutationId: string,
  details: {
    actualVersion: number | null
    expectedVersion: number | null
    message: string
  },
  expectedWorkspaceId?: string,
  expectedWriteGeneration?: number,
): Promise<void> {
  const db = await getPlannerOfflineDatabase(expectedWorkspaceId)

  if (!db) {
    return
  }

  await runPlannerMutationQueueWrite(
    db,
    mutationId,
    expectedWorkspaceId,
    expectedWriteGeneration,
    () =>
      db.mutationQueue.update(mutationId, {
        conflictActualVersion: details.actualVersion,
        conflictExpectedVersion: details.expectedVersion,
        lastError: details.message,
        status: 'conflicted',
        updatedAt: new Date().toISOString(),
      }),
  )
}

async function getPlannerOfflineDatabase(
  workspaceId?: string,
): Promise<PlannerOfflineDatabase | null> {
  ensurePlannerOfflineLifecycleStorageListener()
  const db = getPlannerOfflineLifecycleDatabase()

  if (!db) {
    return null
  }

  try {
    await ensurePendingPlannerOfflinePurgesFlushed(db)
  } catch {
    return null
  }

  if (workspaceId) {
    await reconcilePlannerOfflineDatabaseGeneration(db, workspaceId)

    if (isPlannerOfflineWorkspaceRuntimeInvalidated(workspaceId)) {
      return null
    }
  }

  return db
}

function getPlannerOfflineLifecycleDatabase(): PlannerOfflineDatabase | null {
  if (!isPlannerOfflineStorageAvailable()) {
    return null
  }

  database ??= new PlannerOfflineDatabase()

  return database
}

async function runPlannerCacheWrite<T>(
  db: PlannerOfflineDatabase,
  workspaceId: string,
  scope: PlannerWorkspaceWriteScope,
  expectedWriteGeneration: number,
  tables: readonly Table[],
  write: () => Promise<T>,
): Promise<T | undefined> {
  const writeKey = `${workspaceId}:${scope}`
  const previous = pendingCacheWrites.get(writeKey) ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      if (
        !isPlannerOfflineWorkspaceWriteGenerationCurrent(
          workspaceId,
          expectedWriteGeneration,
        )
      ) {
        return undefined
      }

      const transactionTables = tables.includes(db.syncMetadata)
        ? tables
        : [db.syncMetadata, ...tables]

      return db.transaction('rw', transactionTables, async () => {
        if (
          !isPlannerOfflineWorkspaceWriteGenerationCurrent(
            workspaceId,
            expectedWriteGeneration,
          )
        ) {
          return undefined
        }

        const persistedGeneration =
          (
            await db.syncMetadata.get(
              createWorkspaceLifecycleMetadataKey(workspaceId),
            )
          )?.value ?? 0

        if (persistedGeneration > expectedWriteGeneration) {
          invalidatePlannerOfflineWorkspaceRuntime(
            workspaceId,
            persistedGeneration,
          )
          return undefined
        }

        if (persistedGeneration < expectedWriteGeneration) {
          const baselineGeneration =
            runtimeLifecycleBaseline.writeGenerations[workspaceId] ?? 0

          if (baselineGeneration < expectedWriteGeneration) {
            invalidatePlannerOfflineWorkspaceRuntime(
              workspaceId,
              expectedWriteGeneration,
            )
            return undefined
          }

          await putPlannerWorkspaceLifecycleGeneration(
            db,
            workspaceId,
            expectedWriteGeneration,
          )
        }

        return write()
      })
    })
  pendingCacheWrites.set(writeKey, current)

  try {
    return await current
  } finally {
    if (pendingCacheWrites.get(writeKey) === current) {
      pendingCacheWrites.delete(writeKey)
    }
  }
}

async function runPlannerMutationQueueWrite<T>(
  db: PlannerOfflineDatabase,
  mutationId: string,
  expectedWorkspaceId: string | undefined,
  expectedWriteGeneration: number | undefined,
  write: (mutation: PlannerOfflineMutationRecord) => Promise<T>,
): Promise<T | undefined> {
  const mutation = await db.mutationQueue.get(mutationId)

  if (
    !mutation ||
    (expectedWorkspaceId && mutation.workspaceId !== expectedWorkspaceId)
  ) {
    return undefined
  }

  const workspaceId = expectedWorkspaceId ?? mutation.workspaceId
  const writeGeneration =
    expectedWriteGeneration ??
    getPlannerOfflineWorkspaceWriteGeneration(workspaceId)

  return runPlannerCacheWrite(
    db,
    workspaceId,
    'mutation-queue',
    writeGeneration,
    [db.mutationQueue],
    async () => {
      const currentMutation = await db.mutationQueue.get(mutationId)

      if (!currentMutation || currentMutation.workspaceId !== workspaceId) {
        return undefined
      }

      return write(currentMutation)
    },
  )
}

async function waitForPlannerWorkspaceWrites(
  workspaceId: string,
): Promise<void> {
  const prefix = `${workspaceId}:`
  const writes = [...pendingCacheWrites.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, write]) => write)

  await Promise.allSettled(writes)
}

async function ensurePendingPlannerOfflinePurgesFlushed(
  db: PlannerOfflineDatabase,
): Promise<void> {
  if (!hasPendingPlannerOfflinePurges()) {
    return
  }

  lifecycleFlush ??= flushPendingPlannerOfflinePurges(db).finally(() => {
    lifecycleFlush = null
  })
  await lifecycleFlush
}

async function flushPendingPlannerOfflinePurges(
  db: PlannerOfflineDatabase,
): Promise<void> {
  for (;;) {
    const pendingPurges = {
      ...readStoredPlannerOfflineLifecycleState().pendingPurges,
    }

    for (const [workspaceId, generation] of localPendingPurgeWorkspaces) {
      pendingPurges[workspaceId] = Math.max(
        pendingPurges[workspaceId] ?? 0,
        generation,
      )
    }

    const workspaceIds = Object.keys(pendingPurges)

    if (workspaceIds.length === 0) {
      return
    }

    if (!persistPlannerOfflinePendingPurges(pendingPurges)) {
      throw new PlannerOfflinePurgeUnavailableError()
    }

    await Promise.all(
      workspaceIds.map((workspaceId) =>
        waitForPlannerWorkspaceWrites(workspaceId),
      ),
    )
    await purgePlannerOfflineWorkspaces(db, pendingPurges)

    if (!completePlannerOfflineWorkspacePurges(pendingPurges)) {
      throw new PlannerOfflinePurgeUnavailableError()
    }
  }
}

function beginPlannerOfflineWorkspacePurge(
  workspaceId: string,
  generation: number,
): boolean {
  workspaceWriteGenerations.set(workspaceId, generation)
  localPendingPurgeWorkspaces.set(workspaceId, generation)
  invalidatePlannerOfflineWorkspaceRuntime(workspaceId, generation)

  return persistPlannerOfflinePendingPurges({ [workspaceId]: generation })
}

function persistPlannerOfflinePendingPurges(
  pendingPurges: Readonly<Record<string, number>>,
): boolean {
  let persistedEveryWorkspace = true

  for (const [workspaceId, generation] of Object.entries(pendingPurges)) {
    const current = readStoredPlannerOfflineWorkspaceLifecycleState(workspaceId)
    const next: PlannerOfflineWorkspaceLifecycleState = {
      pendingPurgeGeneration: Math.max(
        current?.pendingPurgeGeneration ?? 0,
        generation,
      ),
      writeGeneration: Math.max(current?.writeGeneration ?? 0, generation),
    }

    if (!writeStoredPlannerOfflineWorkspaceLifecycleState(workspaceId, next)) {
      persistedEveryWorkspace = false
    }
  }

  return persistedEveryWorkspace
}

async function purgePlannerOfflineWorkspaces(
  db: PlannerOfflineDatabase,
  pendingPurges: Readonly<Record<string, number>>,
): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.cachedLifeSpheres,
      db.cachedTaskTemplates,
      db.cachedTasks,
      db.dataSyncMetadata,
      db.mutationQueue,
      db.syncMetadata,
    ],
    async () => {
      for (const [workspaceId, generation] of Object.entries(pendingPurges)) {
        const lifecycleKey = createWorkspaceLifecycleMetadataKey(workspaceId)
        const persistedGeneration =
          (await db.syncMetadata.get(lifecycleKey))?.value ?? 0

        await putPlannerWorkspaceLifecycleGeneration(
          db,
          workspaceId,
          Math.max(generation, persistedGeneration),
        )
        await Promise.all([
          db.cachedLifeSpheres
            .where('workspaceId')
            .equals(workspaceId)
            .delete(),
          db.cachedTaskTemplates
            .where('workspaceId')
            .equals(workspaceId)
            .delete(),
          db.cachedTasks.where('workspaceId').equals(workspaceId).delete(),
          db.dataSyncMetadata.where('workspaceId').equals(workspaceId).delete(),
          db.mutationQueue.where('workspaceId').equals(workspaceId).delete(),
          db.syncMetadata
            .where('workspaceId')
            .equals(workspaceId)
            .filter((row) => row.key !== lifecycleKey)
            .delete(),
        ])
      }
    },
  )
}

function completePlannerOfflineWorkspacePurges(
  completedPurges: Readonly<Record<string, number>>,
): boolean {
  let completedEveryWorkspace = true

  for (const [workspaceId, generation] of Object.entries(completedPurges)) {
    const current = readStoredPlannerOfflineWorkspaceLifecycleState(workspaceId)

    if (!current || current.writeGeneration < generation) {
      completedEveryWorkspace = false
      continue
    }

    if (
      current.pendingPurgeGeneration !== null &&
      current.pendingPurgeGeneration <= generation &&
      !writeStoredPlannerOfflineWorkspaceLifecycleState(workspaceId, {
        pendingPurgeGeneration: null,
        writeGeneration: current.writeGeneration,
      })
    ) {
      completedEveryWorkspace = false
      continue
    }

    const persisted =
      readStoredPlannerOfflineWorkspaceLifecycleState(workspaceId)

    if (
      !persisted ||
      persisted.writeGeneration < generation ||
      (persisted.pendingPurgeGeneration !== null &&
        persisted.pendingPurgeGeneration <= generation)
    ) {
      completedEveryWorkspace = false
    }
  }

  if (!completedEveryWorkspace) {
    return false
  }

  for (const [workspaceId, generation] of Object.entries(completedPurges)) {
    const localGeneration = localPendingPurgeWorkspaces.get(workspaceId)

    if (localGeneration !== undefined && localGeneration <= generation) {
      localPendingPurgeWorkspaces.delete(workspaceId)
    }
  }

  return true
}

function hasPendingPlannerOfflinePurges(): boolean {
  return (
    localPendingPurgeWorkspaces.size > 0 ||
    Object.keys(readStoredPlannerOfflineLifecycleState().pendingPurges).length >
      0
  )
}

function readStoredPlannerOfflineLifecycleState(): PlannerOfflineLifecycleState {
  if (typeof window === 'undefined') {
    return { pendingPurges: {}, writeGenerations: {} }
  }

  const lifecycle: PlannerOfflineLifecycleState = {
    pendingPurges: {},
    writeGenerations: {},
  }

  try {
    migrateLegacyPlannerOfflineLifecycleState()

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const storageKey = window.localStorage.key(index)
      const workspaceId =
        readPlannerOfflineWorkspaceIdFromStorageKey(storageKey)

      if (!workspaceId || !storageKey) {
        continue
      }

      const workspaceLifecycle = parsePlannerOfflineWorkspaceLifecycleState(
        window.localStorage.getItem(storageKey),
      )

      if (!workspaceLifecycle) {
        continue
      }

      lifecycle.writeGenerations[workspaceId] =
        workspaceLifecycle.writeGeneration

      if (workspaceLifecycle.pendingPurgeGeneration !== null) {
        lifecycle.pendingPurges[workspaceId] =
          workspaceLifecycle.pendingPurgeGeneration
      }
    }
  } catch {
    return lifecycle
  }

  return lifecycle
}

function readStoredPlannerOfflineWorkspaceLifecycleState(
  workspaceId: string,
): PlannerOfflineWorkspaceLifecycleState | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return parsePlannerOfflineWorkspaceLifecycleState(
      window.localStorage.getItem(
        createPlannerOfflineWorkspaceLifecycleStorageKey(workspaceId),
      ),
    )
  } catch {
    return null
  }
}

function parsePlannerOfflineWorkspaceLifecycleState(
  rawValue: string | null,
): PlannerOfflineWorkspaceLifecycleState | null {
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    const lifecycle = parsed as Record<string, unknown>
    const writeGeneration = readPlannerOfflineGeneration(
      lifecycle.writeGeneration,
    )
    let pendingPurgeGeneration: number | null | undefined

    if (lifecycle.pendingPurgeGeneration === null) {
      pendingPurgeGeneration = null
    } else {
      pendingPurgeGeneration =
        readPlannerOfflineGeneration(lifecycle.pendingPurgeGeneration) ??
        undefined
    }

    if (writeGeneration === null || pendingPurgeGeneration === undefined) {
      return null
    }

    return {
      pendingPurgeGeneration,
      writeGeneration: Math.max(writeGeneration, pendingPurgeGeneration ?? 0),
    }
  } catch {
    return null
  }
}

function readPlannerOfflineGeneration(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function parseLegacyPlannerOfflineLifecycleState(
  value: unknown,
): PlannerOfflineLifecycleState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { pendingPurges: {}, writeGenerations: {} }
  }

  const lifecycle = value as Record<string, unknown>
  return {
    pendingPurges: sanitizeLegacyPlannerOfflineGenerationRecord(
      lifecycle.pendingPurges,
    ),
    writeGenerations: sanitizeLegacyPlannerOfflineGenerationRecord(
      lifecycle.writeGenerations,
    ),
  }
}

function sanitizeLegacyPlannerOfflineGenerationRecord(
  value: unknown,
): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        readPlannerOfflineGeneration(entry[1]) !== null,
    ),
  )
}

function migrateLegacyPlannerOfflineLifecycleState(): void {
  if (typeof window === 'undefined') {
    return
  }

  const rawValue = window.localStorage.getItem(
    PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY,
  )

  if (!rawValue) {
    return
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(rawValue) as unknown
  } catch {
    return
  }

  const legacy = parseLegacyPlannerOfflineLifecycleState(parsed)
  const workspaceIds = new Set([
    ...Object.keys(legacy.writeGenerations),
    ...Object.keys(legacy.pendingPurges),
  ])
  let migratedEveryWorkspace = true

  for (const workspaceId of workspaceIds) {
    const current = readStoredPlannerOfflineWorkspaceLifecycleState(workspaceId)
    const pendingPurgeGeneration = Math.max(
      current?.pendingPurgeGeneration ?? 0,
      legacy.pendingPurges[workspaceId] ?? 0,
    )
    const next: PlannerOfflineWorkspaceLifecycleState = {
      pendingPurgeGeneration:
        pendingPurgeGeneration > 0 ? pendingPurgeGeneration : null,
      writeGeneration: Math.max(
        current?.writeGeneration ?? 0,
        legacy.writeGenerations[workspaceId] ?? 0,
        pendingPurgeGeneration,
      ),
    }

    if (!writeStoredPlannerOfflineWorkspaceLifecycleState(workspaceId, next)) {
      migratedEveryWorkspace = false
    }
  }

  if (migratedEveryWorkspace) {
    window.localStorage.removeItem(PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY)
  }
}

function writeStoredPlannerOfflineWorkspaceLifecycleState(
  workspaceId: string,
  lifecycle: PlannerOfflineWorkspaceLifecycleState,
): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    window.localStorage.setItem(
      createPlannerOfflineWorkspaceLifecycleStorageKey(workspaceId),
      JSON.stringify(lifecycle),
    )
    const persisted =
      readStoredPlannerOfflineWorkspaceLifecycleState(workspaceId)

    return Boolean(
      persisted &&
      persisted.writeGeneration >= lifecycle.writeGeneration &&
      (lifecycle.pendingPurgeGeneration === null
        ? persisted.pendingPurgeGeneration === null ||
          persisted.pendingPurgeGeneration > lifecycle.writeGeneration
        : persisted.pendingPurgeGeneration !== null &&
          persisted.pendingPurgeGeneration >= lifecycle.pendingPurgeGeneration),
    )
  } catch {
    return false
  }
}

function createPlannerOfflineWorkspaceLifecycleStorageKey(
  workspaceId: string,
): string {
  return `${PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX}${encodeURIComponent(workspaceId)}`
}

function readPlannerOfflineWorkspaceIdFromStorageKey(
  storageKey: string | null,
): string | null {
  if (!storageKey?.startsWith(PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX)) {
    return null
  }

  const encodedWorkspaceId = storageKey.slice(
    PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX.length,
  )

  if (!encodedWorkspaceId) {
    return null
  }

  try {
    return decodeURIComponent(encodedWorkspaceId)
  } catch {
    return null
  }
}

function removeStoredPlannerOfflineLifecycleState(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const keysToRemove: string[] = []

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const storageKey = window.localStorage.key(index)

      if (
        storageKey === PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY ||
        storageKey?.startsWith(PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX)
      ) {
        keysToRemove.push(storageKey)
      }
    }

    for (const storageKey of keysToRemove) {
      window.localStorage.removeItem(storageKey)
    }
  } catch {
    // Test cleanup remains best-effort when localStorage is unavailable.
  }
}

function ensurePlannerOfflineLifecycleStorageListener(): void {
  if (lifecycleStorageListenerAttached || typeof window === 'undefined') {
    return
  }

  window.addEventListener('storage', handlePlannerOfflineLifecycleStorage)
  lifecycleStorageListenerAttached = true
}

function handlePlannerOfflineLifecycleStorage(event: StorageEvent): void {
  if (event.key === PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY) {
    if (!event.newValue) {
      return
    }

    try {
      const lifecycle = parseLegacyPlannerOfflineLifecycleState(
        JSON.parse(event.newValue) as unknown,
      )

      for (const [workspaceId, generation] of Object.entries(
        lifecycle.writeGenerations,
      )) {
        observePlannerOfflineLifecycleGeneration(workspaceId, generation)
      }
    } catch {
      // Ignore malformed lifecycle events from obsolete app versions.
    }

    return
  }

  const workspaceId = readPlannerOfflineWorkspaceIdFromStorageKey(event.key)
  const lifecycle = parsePlannerOfflineWorkspaceLifecycleState(event.newValue)

  if (!workspaceId || !lifecycle) {
    return
  }

  observePlannerOfflineLifecycleGeneration(
    workspaceId,
    lifecycle.writeGeneration,
  )
}

function observePlannerOfflineLifecycleGeneration(
  workspaceId: string,
  generation: number,
): void {
  const baselineGeneration =
    runtimeLifecycleBaseline.writeGenerations[workspaceId] ?? 0

  if (generation > baselineGeneration) {
    invalidatePlannerOfflineWorkspaceRuntime(workspaceId, generation)
  }

  workspaceWriteGenerations.set(
    workspaceId,
    Math.max(workspaceWriteGenerations.get(workspaceId) ?? 0, generation),
  )
}

function isPlannerOfflineWorkspaceRuntimeInvalidated(
  workspaceId: string,
): boolean {
  return runtimeInvalidatedWorkspaces.has(workspaceId)
}

function invalidatePlannerOfflineWorkspaceRuntime(
  workspaceId: string,
  generation: number,
): void {
  runtimeInvalidatedWorkspaces.set(
    workspaceId,
    Math.max(runtimeInvalidatedWorkspaces.get(workspaceId) ?? 0, generation),
  )
  workspaceWriteGenerations.set(
    workspaceId,
    Math.max(workspaceWriteGenerations.get(workspaceId) ?? 0, generation),
  )
}

async function reconcilePlannerOfflineDatabaseGeneration(
  db: PlannerOfflineDatabase,
  workspaceId: string,
): Promise<void> {
  const persistedGeneration =
    (
      await db.syncMetadata.get(
        createWorkspaceLifecycleMetadataKey(workspaceId),
      )
    )?.value ?? 0
  const runtimeGeneration =
    getPlannerOfflineWorkspaceWriteGeneration(workspaceId)

  if (persistedGeneration > runtimeGeneration) {
    invalidatePlannerOfflineWorkspaceRuntime(workspaceId, persistedGeneration)
  }
}

function createCachedTaskKey(workspaceId: string, taskId: string): string {
  return `${workspaceId}:${taskId}`
}

function createCachedLifeSphereKey(
  workspaceId: string,
  sphereId: string,
): string {
  return `${workspaceId}:${sphereId}`
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

function createWorkspaceLifecycleMetadataKey(workspaceId: string): string {
  return `${workspaceId}:offline-write-generation`
}

async function putPlannerWorkspaceLifecycleGeneration(
  db: PlannerOfflineDatabase,
  workspaceId: string,
  generation: number,
): Promise<void> {
  await db.syncMetadata.put({
    key: createWorkspaceLifecycleMetadataKey(workspaceId),
    updatedAt: new Date().toISOString(),
    value: generation,
    workspaceId,
  })
}

function createDataSyncMetadataKey(
  workspaceId: string,
  scope: PlannerDataSyncScope,
): string {
  return `${workspaceId}:data-sync:${scope}`
}

async function putPlannerDataSyncMetadata(
  db: PlannerOfflineDatabase,
  workspaceId: string,
  scope: PlannerDataSyncScope,
  lastSuccessfulSyncAt: string,
): Promise<void> {
  await db.dataSyncMetadata.put({
    key: createDataSyncMetadataKey(workspaceId, scope),
    lastSuccessfulSyncAt,
    scope,
    workspaceId,
  })
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
