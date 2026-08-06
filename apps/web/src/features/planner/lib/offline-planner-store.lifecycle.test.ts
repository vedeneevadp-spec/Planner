import 'fake-indexeddb/auto'

import type { NewTaskInput, TaskRecord } from '@planner/contracts'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearPlannerOfflineWorkspaceData,
  countRetryablePlannerOfflineMutations,
  enqueuePlannerOfflineMutation,
  getPlannerOfflineWorkspaceWriteGeneration,
  loadCachedTaskRecords,
  PLANNER_OFFLINE_DATABASE_NAME,
  PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
  PlannerOfflinePurgeUnavailableError,
  replaceCachedTaskRecords,
  replaceCachedTaskRecordsFromServer,
  resetPlannerOfflineDatabaseForTests,
  resetPlannerOfflineRuntimeForTests,
} from './offline-planner-store'

const WORKSPACE_ID = 'workspace-lifecycle'
const SECOND_WORKSPACE_ID = 'workspace-lifecycle-second'
const ACTOR_USER_ID = 'user-lifecycle'

describe('offline planner workspace lifecycle', () => {
  beforeEach(async () => {
    await resetPlannerOfflineDatabaseForTests()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await resetPlannerOfflineDatabaseForTests()
  })

  it('blocks stale and newly-created writes in an old tab after a cross-tab purge', async () => {
    await replaceCachedTaskRecords(WORKSPACE_ID, [createTaskRecord('before')])
    await enqueueTaskMutation('queued-before')
    const staleGeneration =
      getPlannerOfflineWorkspaceWriteGeneration(WORKSPACE_ID)

    await simulateCompletedCrossTabPurge(staleGeneration + 1)

    await replaceCachedTaskRecordsFromServer(
      WORKSPACE_ID,
      [createTaskRecord('late-server-response')],
      '2026-08-06T09:00:00.000Z',
      staleGeneration,
    )
    await expect(enqueueTaskMutation('created-by-old-tab')).resolves.toBeNull()

    await expect(loadCachedTaskRecords(WORKSPACE_ID)).resolves.toEqual([])
    await expect(
      countRetryablePlannerOfflineMutations(WORKSPACE_ID),
    ).resolves.toBe(0)
    await expect(readWorkspaceRowCounts()).resolves.toEqual({
      cachedTasks: 0,
      mutationQueue: 0,
    })

    resetPlannerOfflineRuntimeForTests()

    await expect(enqueueTaskMutation('created-after-reload')).resolves.not.toBe(
      null,
    )
    await expect(
      countRetryablePlannerOfflineMutations(WORKSPACE_ID),
    ).resolves.toBe(1)
  })

  it('fails closed from the IndexedDB generation when a storage event was missed', async () => {
    await replaceCachedTaskRecords(WORKSPACE_ID, [createTaskRecord('before')])
    const staleGeneration =
      getPlannerOfflineWorkspaceWriteGeneration(WORKSPACE_ID)
    const db = new Dexie(PLANNER_OFFLINE_DATABASE_NAME)
    await db.open()

    await db.transaction(
      'rw',
      [db.table('cachedTasks'), db.table('syncMetadata')],
      async () => {
        await db.table('syncMetadata').put({
          key: `${WORKSPACE_ID}:offline-write-generation`,
          updatedAt: new Date().toISOString(),
          value: staleGeneration + 1,
          workspaceId: WORKSPACE_ID,
        })
        await db
          .table('cachedTasks')
          .where('workspaceId')
          .equals(WORKSPACE_ID)
          .delete()
      },
    )
    db.close()

    await replaceCachedTaskRecordsFromServer(
      WORKSPACE_ID,
      [createTaskRecord('late-server-response')],
      '2026-08-06T09:00:00.000Z',
      staleGeneration,
    )

    await expect(loadCachedTaskRecords(WORKSPACE_ID)).resolves.toEqual([])
    await expect(enqueueTaskMutation('created-after-purge')).resolves.toBeNull()
    await expect(readWorkspaceRowCounts()).resolves.toEqual({
      cachedTasks: 0,
      mutationQueue: 0,
    })
  })

  it('finishes a durable pending purge before a fresh runtime can read or write', async () => {
    await replaceCachedTaskRecords(WORKSPACE_ID, [createTaskRecord('cached')])
    await enqueueTaskMutation('queued')

    persistWorkspaceLifecycle(WORKSPACE_ID, {
      pendingPurgeGeneration: 1,
      writeGeneration: 1,
    })
    resetPlannerOfflineRuntimeForTests()

    await expect(loadCachedTaskRecords(WORKSPACE_ID)).resolves.toEqual([])
    await expect(
      countRetryablePlannerOfflineMutations(WORKSPACE_ID),
    ).resolves.toBe(0)
    expect(readWorkspaceLifecycle(WORKSPACE_ID)).toEqual({
      pendingPurgeGeneration: null,
      writeGeneration: 1,
    })

    await replaceCachedTaskRecords(WORKSPACE_ID, [createTaskRecord('fresh')])
    await expect(loadCachedTaskRecords(WORKSPACE_ID)).resolves.toEqual([
      createTaskRecord('fresh'),
    ])
  })

  it('rejects cleanup and keeps a durable pending marker without IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined)

    await expect(
      clearPlannerOfflineWorkspaceData(WORKSPACE_ID),
    ).rejects.toBeInstanceOf(PlannerOfflinePurgeUnavailableError)
    expect(readWorkspaceLifecycle(WORKSPACE_ID)).toEqual({
      pendingPurgeGeneration: 1,
      writeGeneration: 1,
    })
  })

  it('keeps simultaneous workspace purge markers isolated until each purge completes', async () => {
    await Promise.all([
      replaceCachedTaskRecords(WORKSPACE_ID, [createTaskRecord('first')]),
      replaceCachedTaskRecords(SECOND_WORKSPACE_ID, [
        createTaskRecord('second', SECOND_WORKSPACE_ID),
      ]),
    ])

    const firstPurge = clearPlannerOfflineWorkspaceData(WORKSPACE_ID)
    const secondPurge = clearPlannerOfflineWorkspaceData(SECOND_WORKSPACE_ID)

    expect(readWorkspaceLifecycle(WORKSPACE_ID)).toEqual({
      pendingPurgeGeneration: 1,
      writeGeneration: 1,
    })
    expect(readWorkspaceLifecycle(SECOND_WORKSPACE_ID)).toEqual({
      pendingPurgeGeneration: 1,
      writeGeneration: 1,
    })

    await Promise.all([firstPurge, secondPurge])

    expect(readWorkspaceLifecycle(WORKSPACE_ID)).toEqual({
      pendingPurgeGeneration: null,
      writeGeneration: 1,
    })
    expect(readWorkspaceLifecycle(SECOND_WORKSPACE_ID)).toEqual({
      pendingPurgeGeneration: null,
      writeGeneration: 1,
    })
  })

  it('rejects cleanup if cross-tab invalidation cannot be persisted', async () => {
    await replaceCachedTaskRecords(WORKSPACE_ID, [createTaskRecord('cached')])
    await enqueueTaskMutation('queued')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is unavailable.', 'SecurityError')
    })

    await expect(
      clearPlannerOfflineWorkspaceData(WORKSPACE_ID),
    ).rejects.toBeInstanceOf(PlannerOfflinePurgeUnavailableError)
    await expect(readWorkspaceRowCounts()).resolves.toEqual({
      cachedTasks: 0,
      mutationQueue: 0,
    })
  })
})

async function simulateCompletedCrossTabPurge(
  generation: number,
): Promise<void> {
  const pendingLifecycle = {
    pendingPurgeGeneration: generation,
    writeGeneration: generation,
  }
  persistWorkspaceLifecycle(WORKSPACE_ID, pendingLifecycle)
  dispatchLifecycleStorageEvent(WORKSPACE_ID, pendingLifecycle)

  const db = new Dexie(PLANNER_OFFLINE_DATABASE_NAME)
  await db.open()
  const cachedTasks = db.table('cachedTasks')
  const mutationQueue = db.table('mutationQueue')
  const syncMetadata = db.table('syncMetadata')

  await db.transaction(
    'rw',
    [cachedTasks, mutationQueue, syncMetadata],
    async () => {
      await syncMetadata.put({
        key: `${WORKSPACE_ID}:offline-write-generation`,
        updatedAt: new Date().toISOString(),
        value: generation,
        workspaceId: WORKSPACE_ID,
      })
      await Promise.all([
        cachedTasks.where('workspaceId').equals(WORKSPACE_ID).delete(),
        mutationQueue.where('workspaceId').equals(WORKSPACE_ID).delete(),
      ])
    },
  )
  db.close()

  const completedLifecycle = {
    pendingPurgeGeneration: null,
    writeGeneration: generation,
  }
  persistWorkspaceLifecycle(WORKSPACE_ID, completedLifecycle)
  dispatchLifecycleStorageEvent(WORKSPACE_ID, completedLifecycle)
}

function dispatchLifecycleStorageEvent(
  workspaceId: string,
  lifecycle: unknown,
): void {
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: createWorkspaceLifecycleStorageKey(workspaceId),
      newValue: JSON.stringify(lifecycle),
    }),
  )
}

function persistWorkspaceLifecycle(
  workspaceId: string,
  lifecycle: unknown,
): void {
  window.localStorage.setItem(
    createWorkspaceLifecycleStorageKey(workspaceId),
    JSON.stringify(lifecycle),
  )
}

function readWorkspaceLifecycle(workspaceId: string): unknown {
  const rawValue = window.localStorage.getItem(
    createWorkspaceLifecycleStorageKey(workspaceId),
  )

  return rawValue ? (JSON.parse(rawValue) as unknown) : null
}

function createWorkspaceLifecycleStorageKey(workspaceId: string): string {
  return `${PLANNER_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX}${encodeURIComponent(workspaceId)}`
}

async function readWorkspaceRowCounts(): Promise<{
  cachedTasks: number
  mutationQueue: number
}> {
  const db = new Dexie(PLANNER_OFFLINE_DATABASE_NAME)
  await db.open()
  const result = {
    cachedTasks: await db
      .table('cachedTasks')
      .where('workspaceId')
      .equals(WORKSPACE_ID)
      .count(),
    mutationQueue: await db
      .table('mutationQueue')
      .where('workspaceId')
      .equals(WORKSPACE_ID)
      .count(),
  }
  db.close()

  return result
}

function enqueueTaskMutation(taskId: string) {
  return enqueuePlannerOfflineMutation({
    actorUserId: ACTOR_USER_ID,
    input: createTaskInput(taskId),
    taskId,
    type: 'task.create',
    workspaceId: WORKSPACE_ID,
  })
}

function createTaskInput(taskId: string): NewTaskInput {
  return {
    assigneeUserId: null,
    dueDate: null,
    id: taskId,
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    requiresConfirmation: false,
    resource: null,
    sphereId: null,
    title: `Task ${taskId}`,
  }
}

function createTaskRecord(
  taskId: string,
  workspaceId = WORKSPACE_ID,
): TaskRecord {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: '2026-08-06T08:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    icon: '',
    id: taskId,
    importance: 'not_important',
    necessity: 'desired',
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    requiresConfirmation: false,
    resource: null,
    sphereId: null,
    status: 'todo',
    title: `Task ${taskId}`,
    updatedAt: '2026-08-06T08:00:00.000Z',
    urgency: 'not_urgent',
    version: 1,
    workspaceId,
  }
}
