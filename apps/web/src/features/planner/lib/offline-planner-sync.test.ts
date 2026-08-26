import 'fake-indexeddb/auto'

import type {
  LifeSphereRecord,
  NewLifeSphereInput,
  NewTaskInput,
  TaskRecord,
} from '@planner/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearPlannerOfflineWorkspaceData,
  countConflictedPlannerOfflineMutations,
  countRetryablePlannerOfflineMutations,
  enqueuePlannerOfflineMutation,
  getLastTaskEventId,
  getPlannerDataLastSuccessfulSyncAt,
  loadCachedLifeSphereRecords,
  loadCachedTaskRecords,
  replaceCachedTaskRecords,
  replaceCachedTaskRecordsFromServer,
  resetPlannerOfflineDatabaseForTests,
  setPlannerDataLastSuccessfulSyncAt,
} from './offline-planner-store'
import { drainPlannerOfflineQueue } from './offline-planner-sync'
import { type PlannerApiClient, PlannerApiError } from './planner-api'

const WORKSPACE_ID = 'workspace-1'
const ACTOR_USER_ID = 'user-1'

const createInput: NewTaskInput = {
  assigneeUserId: null,
  dueDate: null,
  id: '01963dd0-7f58-7de6-9c7f-9a5f7bdfd8b2',
  note: '',
  plannedDate: null,
  plannedEndTime: null,
  plannedStartTime: null,
  project: '',
  projectId: null,
  resource: null,
  requiresConfirmation: false,
  sphereId: null,
  title: 'Offline task',
}

const createSphereInput: NewLifeSphereInput = {
  color: '#2f6f62',
  description: 'Offline sphere',
  icon: 'folder',
  id: '01963dd0-7f58-7de6-9c7f-9a5f7bdfd8b3',
  name: 'Offline sphere',
}

describe('offline planner sync', () => {
  beforeEach(async () => {
    await resetPlannerOfflineDatabaseForTests()
  })

  it('tracks server freshness separately from local cache writes', async () => {
    const firstSync = '2026-08-06T08:00:00.000Z'
    const secondSync = '2026-08-06T09:00:00.000Z'

    await setPlannerDataLastSuccessfulSyncAt(WORKSPACE_ID, 'tasks', secondSync)
    await setPlannerDataLastSuccessfulSyncAt(
      WORKSPACE_ID,
      'life-spheres',
      firstSync,
    )
    await replaceCachedTaskRecords(WORKSPACE_ID, [createTaskRecord('task-1')])

    expect(
      await getPlannerDataLastSuccessfulSyncAt(WORKSPACE_ID, 'tasks'),
    ).toBe(secondSync)
    expect(await getPlannerDataLastSuccessfulSyncAt(WORKSPACE_ID)).toBeNull()

    await setPlannerDataLastSuccessfulSyncAt(
      WORKSPACE_ID,
      'task-templates',
      secondSync,
    )

    expect(await getPlannerDataLastSuccessfulSyncAt(WORKSPACE_ID)).toBe(
      firstSync,
    )
  })

  it('commits an empty server snapshot and its freshness atomically', async () => {
    const syncedAt = '2026-08-06T08:30:00.000Z'

    await replaceCachedTaskRecordsFromServer(
      WORKSPACE_ID,
      [],
      syncedAt,
      undefined,
      42,
    )

    expect(await loadCachedTaskRecords(WORKSPACE_ID)).toEqual([])
    expect(await getLastTaskEventId(WORKSPACE_ID)).toBe(42)
    expect(
      await getPlannerDataLastSuccessfulSyncAt(WORKSPACE_ID, 'tasks'),
    ).toBe(syncedAt)
  })

  it('does not advance freshness when a server snapshot cannot be stored', async () => {
    const invalidRecord = {
      ...createTaskRecord('task-invalid'),
      nonCloneableValue: () => undefined,
    } as unknown as TaskRecord

    await expect(
      replaceCachedTaskRecordsFromServer(
        WORKSPACE_ID,
        [invalidRecord],
        '2026-08-06T08:30:00.000Z',
        undefined,
        43,
      ),
    ).rejects.toBeDefined()
    expect(
      await getPlannerDataLastSuccessfulSyncAt(WORKSPACE_ID, 'tasks'),
    ).toBeNull()
    expect(await getLastTaskEventId(WORKSPACE_ID)).toBe(0)
    expect(await loadCachedTaskRecords(WORKSPACE_ID)).toEqual([])
  })

  it('never regresses the task event cursor with an older snapshot', async () => {
    await replaceCachedTaskRecordsFromServer(
      WORKSPACE_ID,
      [createTaskRecord('task-newer')],
      '2026-08-06T09:00:00.000Z',
      undefined,
      42,
    )
    await replaceCachedTaskRecordsFromServer(
      WORKSPACE_ID,
      [createTaskRecord('task-older')],
      '2026-08-06T08:30:00.000Z',
      undefined,
      41,
    )

    expect(await getLastTaskEventId(WORKSPACE_ID)).toBe(42)
    expect(
      (await loadCachedTaskRecords(WORKSPACE_ID)).map((task) => task.id),
    ).toEqual(['task-newer'])
  })

  it('replays queued creates through the API and caches the server record', async () => {
    const taskRecord = createTaskRecord(createInput.id!)
    const api = createPlannerApiClientMock({
      createTask: vi.fn().mockResolvedValue(taskRecord),
    })

    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      input: createInput,
      taskId: createInput.id!,
      type: 'task.create',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toEqual({
      conflicted: 0,
      failed: 0,
      processed: 1,
      synced: 1,
    })
    expect(api.createTask).toHaveBeenCalledWith(createInput)
    expect(await countRetryablePlannerOfflineMutations(WORKSPACE_ID)).toBe(0)
    expect(await loadCachedTaskRecords(WORKSPACE_ID)).toEqual([taskRecord])
  })

  it('replays a next-stage command with its stable id and commits both tasks', async () => {
    const stage = createTaskNextStageRecords()
    const onTaskSynced = vi.fn()
    const api = createPlannerApiClientMock({
      createNextTaskStage: vi.fn().mockResolvedValue(stage.response),
    })

    await enqueueNextStageMutation(stage)

    const result = await drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      onTaskSynced,
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toEqual({
      conflicted: 0,
      failed: 0,
      processed: 1,
      synced: 1,
    })
    expect(api.createNextTaskStage).toHaveBeenCalledWith(stage.source.id, {
      chainId: 'chain-1',
      completeCurrent: true,
      expectedVersion: stage.source.version,
      nextTaskId: stage.next.id,
      plannedDate: null,
    })
    expect(onTaskSynced).toHaveBeenCalledTimes(2)
    expect(await loadCachedTaskRecords(WORKSPACE_ID)).toEqual(
      expect.arrayContaining([stage.current, stage.next]),
    )
  })

  it('reconciles a lost next-stage response without creating a duplicate', async () => {
    const stage = createTaskNextStageRecords()
    const api = createPlannerApiClientMock({
      createNextTaskStage: vi.fn().mockRejectedValue(
        new PlannerApiError('Version conflict', {
          code: 'task_version_conflict',
          details: {
            actualVersion: stage.current.version,
            expectedVersion: stage.source.version,
          },
          status: 409,
        }),
      ),
      getTask: vi.fn((taskId: string) =>
        Promise.resolve(
          taskId === stage.current.id ? stage.current : stage.next,
        ),
      ),
    })

    await enqueueNextStageMutation(stage)

    await expect(
      drainPlannerOfflineQueue({
        actorUserId: ACTOR_USER_ID,
        api,
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toEqual({
      conflicted: 0,
      failed: 0,
      processed: 1,
      synced: 1,
    })
    expect(api.createNextTaskStage).toHaveBeenCalledTimes(1)
    expect(api.getTask).toHaveBeenCalledTimes(2)
    expect(api.getTask).toHaveBeenCalledWith(stage.current.id)
    expect(api.getTask).toHaveBeenCalledWith(stage.next.id)
    expect(await countConflictedPlannerOfflineMutations(WORKSPACE_ID)).toBe(0)
    expect(await loadCachedTaskRecords(WORKSPACE_ID)).toEqual(
      expect.arrayContaining([stage.current, stage.next]),
    )
  })

  it('does not overwrite newer task projections with older replay responses', async () => {
    const createdTask = createTaskRecord(createInput.id!)
    const updatedTask = {
      ...createdTask,
      title: 'Updated offline task',
      version: 2,
    }
    const completedTask = {
      ...updatedTask,
      completedAt: '2026-08-10T09:00:00.000Z',
      status: 'done' as const,
      version: 3,
    }
    const updateInput = {
      assigneeUserId: createInput.assigneeUserId,
      dueDate: createInput.dueDate,
      note: createInput.note,
      plannedDate: createInput.plannedDate,
      plannedEndTime: createInput.plannedEndTime,
      plannedStartTime: createInput.plannedStartTime,
      project: createInput.project,
      projectId: createInput.projectId,
      requiresConfirmation: createInput.requiresConfirmation,
      resource: createInput.resource,
      sphereId: createInput.sphereId,
      title: updatedTask.title,
    }
    const onTaskSynced = vi.fn()
    const api = createPlannerApiClientMock({
      createTask: vi.fn().mockResolvedValue(createdTask),
      setTaskStatus: vi.fn().mockResolvedValue(completedTask),
      updateTask: vi.fn().mockResolvedValue(updatedTask),
    })

    await enqueuePlannerOfflineMutation(
      {
        actorUserId: ACTOR_USER_ID,
        input: createInput,
        taskId: createInput.id!,
        type: 'task.create',
        workspaceId: WORKSPACE_ID,
      },
      { optimisticTask: createdTask },
    )
    await waitForNextMutationTimestamp()
    await enqueuePlannerOfflineMutation(
      {
        actorUserId: ACTOR_USER_ID,
        expectedVersion: 1,
        input: updateInput,
        taskId: createInput.id!,
        type: 'task.update',
        workspaceId: WORKSPACE_ID,
      },
      { optimisticTask: updatedTask },
    )
    await waitForNextMutationTimestamp()
    await enqueuePlannerOfflineMutation(
      {
        actorUserId: ACTOR_USER_ID,
        expectedVersion: 2,
        statusValue: 'done',
        taskId: createInput.id!,
        type: 'task.status.update',
        workspaceId: WORKSPACE_ID,
      },
      { optimisticTask: completedTask },
    )

    const result = await drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      onTaskSynced,
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toEqual({
      conflicted: 0,
      failed: 0,
      processed: 3,
      synced: 3,
    })
    expect(onTaskSynced).toHaveBeenCalledTimes(1)
    expect(onTaskSynced).toHaveBeenCalledWith(completedTask)
    expect(await loadCachedTaskRecords(WORKSPACE_ID)).toEqual([completedTask])
  })

  it('treats an already missing queued task delete as successful', async () => {
    const task = createTaskRecord('already-deleted-task')
    const onTaskDeleted = vi.fn()
    const api = createPlannerApiClientMock({
      removeTask: vi.fn().mockRejectedValue(
        new PlannerApiError('Task was not found.', {
          code: 'task_not_found',
          status: 404,
        }),
      ),
    })
    await replaceCachedTaskRecords(WORKSPACE_ID, [task])
    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      expectedVersion: task.version,
      taskId: task.id,
      type: 'task.delete',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      onTaskDeleted,
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toEqual({
      conflicted: 0,
      failed: 0,
      processed: 1,
      synced: 1,
    })
    expect(onTaskDeleted).toHaveBeenCalledWith(task.id)
    expect(await loadCachedTaskRecords(WORKSPACE_ID)).toEqual([])
  })

  it('never replays another actor mutation from the same workspace', async () => {
    const otherActorUserId = 'user-2'
    const taskRecord = createTaskRecord(createInput.id!)
    const api = createPlannerApiClientMock({
      createTask: vi.fn().mockResolvedValue(taskRecord),
    })

    await enqueuePlannerOfflineMutation({
      actorUserId: otherActorUserId,
      input: { ...createInput, title: 'Other actor task' },
      taskId: createInput.id!,
      type: 'task.create',
      workspaceId: WORKSPACE_ID,
    })
    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      input: createInput,
      taskId: createInput.id!,
      type: 'task.create',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result.processed).toBe(1)
    expect(api.createTask).toHaveBeenCalledTimes(1)
    expect(api.createTask).toHaveBeenCalledWith(createInput)
    expect(
      await countRetryablePlannerOfflineMutations(
        WORKSPACE_ID,
        otherActorUserId,
      ),
    ).toBe(1)
  })

  it('marks stale queued mutations as conflicted', async () => {
    const api = createPlannerApiClientMock({
      setTaskStatus: vi.fn().mockRejectedValue(
        new PlannerApiError('Task version conflict.', {
          code: 'task_version_conflict',
          details: {
            actualVersion: 3,
            expectedVersion: 1,
          },
          status: 409,
        }),
      ),
    })

    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      expectedVersion: 1,
      statusValue: 'done',
      taskId: 'task-1',
      type: 'task.status.update',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result.conflicted).toBe(1)
    expect(await countRetryablePlannerOfflineMutations(WORKSPACE_ID)).toBe(0)
    expect(await countConflictedPlannerOfflineMutations(WORKSPACE_ID)).toBe(1)
  })

  it('marks terminal stale mutations as conflicted and continues replaying the queue', async () => {
    const taskRecord = createTaskRecord(createInput.id!)
    const api = createPlannerApiClientMock({
      createTask: vi.fn().mockResolvedValue(taskRecord),
      updateTask: vi.fn().mockRejectedValue(
        new PlannerApiError('Task was deleted on the server.', {
          code: 'task_not_found',
          status: 404,
        }),
      ),
    })
    const updateInput = {
      assigneeUserId: createInput.assigneeUserId,
      dueDate: createInput.dueDate,
      note: createInput.note,
      plannedDate: createInput.plannedDate,
      plannedEndTime: createInput.plannedEndTime,
      plannedStartTime: createInput.plannedStartTime,
      project: createInput.project,
      projectId: createInput.projectId,
      requiresConfirmation: createInput.requiresConfirmation,
      resource: createInput.resource,
      sphereId: createInput.sphereId,
      title: 'Stale offline update',
    }

    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      expectedVersion: 1,
      input: updateInput,
      taskId: 'stale-task',
      type: 'task.update',
      workspaceId: WORKSPACE_ID,
    })
    await waitForNextMutationTimestamp()
    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      input: createInput,
      taskId: createInput.id!,
      type: 'task.create',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toEqual({
      conflicted: 1,
      failed: 0,
      processed: 2,
      synced: 1,
    })
    expect(api.updateTask).toHaveBeenCalledWith('stale-task', {
      ...updateInput,
      expectedVersion: 1,
    })
    expect(api.createTask).toHaveBeenCalledWith(createInput)
    expect(await countRetryablePlannerOfflineMutations(WORKSPACE_ID)).toBe(0)
    expect(await countConflictedPlannerOfflineMutations(WORKSPACE_ID)).toBe(1)
    expect(await loadCachedTaskRecords(WORKSPACE_ID)).toEqual([taskRecord])
  })

  it('replays queued sphere creates through the API and caches the server record', async () => {
    const sphereRecord = createLifeSphereRecord(createSphereInput.id!)
    const api = createPlannerApiClientMock({
      createLifeSphere: vi.fn().mockResolvedValue(sphereRecord),
    })

    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      input: createSphereInput,
      sphereId: createSphereInput.id!,
      type: 'lifeSphere.create',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result.synced).toBe(1)
    expect(api.createLifeSphere).toHaveBeenCalledWith(createSphereInput)
    expect(await countRetryablePlannerOfflineMutations(WORKSPACE_ID)).toBe(0)
    expect(await loadCachedLifeSphereRecords(WORKSPACE_ID)).toEqual([
      sphereRecord,
    ])
  })

  it('lets workspace cleanup win over a delayed task replay and removes the remaining queue', async () => {
    const deferredTask = createDeferred<TaskRecord>()
    const onLifeSphereSynced = vi.fn()
    const onTaskSynced = vi.fn()
    const api = createPlannerApiClientMock({
      createLifeSphere: vi
        .fn()
        .mockResolvedValue(createLifeSphereRecord(createSphereInput.id!)),
      createTask: vi.fn().mockReturnValue(deferredTask.promise),
    })

    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      input: createInput,
      taskId: createInput.id!,
      type: 'task.create',
      workspaceId: WORKSPACE_ID,
    })
    await waitForNextMutationTimestamp()
    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      input: createSphereInput,
      sphereId: createSphereInput.id!,
      type: 'lifeSphere.create',
      workspaceId: WORKSPACE_ID,
    })

    const drainPromise = drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      onLifeSphereSynced,
      onTaskSynced,
      workspaceId: WORKSPACE_ID,
    })

    await vi.waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(1))
    await clearPlannerOfflineWorkspaceData(WORKSPACE_ID)
    deferredTask.resolve(createTaskRecord(createInput.id!))

    await expect(drainPromise).resolves.toEqual({
      conflicted: 0,
      failed: 0,
      processed: 1,
      synced: 0,
    })
    expect(api.createLifeSphere).not.toHaveBeenCalled()
    expect(onTaskSynced).not.toHaveBeenCalled()
    expect(onLifeSphereSynced).not.toHaveBeenCalled()
    await expect(loadCachedTaskRecords(WORKSPACE_ID)).resolves.toEqual([])
    await expect(loadCachedLifeSphereRecords(WORKSPACE_ID)).resolves.toEqual([])
    await expect(
      countRetryablePlannerOfflineMutations(WORKSPACE_ID),
    ).resolves.toBe(0)
    await expect(
      countConflictedPlannerOfflineMutations(WORKSPACE_ID),
    ).resolves.toBe(0)
  })

  it('does not resurrect a sphere returned after workspace cleanup', async () => {
    const deferredSphere = createDeferred<LifeSphereRecord>()
    const onLifeSphereSynced = vi.fn()
    const api = createPlannerApiClientMock({
      createLifeSphere: vi.fn().mockReturnValue(deferredSphere.promise),
    })

    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      input: createSphereInput,
      sphereId: createSphereInput.id!,
      type: 'lifeSphere.create',
      workspaceId: WORKSPACE_ID,
    })

    const drainPromise = drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      onLifeSphereSynced,
      workspaceId: WORKSPACE_ID,
    })

    await vi.waitFor(() =>
      expect(api.createLifeSphere).toHaveBeenCalledTimes(1),
    )
    await clearPlannerOfflineWorkspaceData(WORKSPACE_ID)
    deferredSphere.resolve(createLifeSphereRecord(createSphereInput.id!))

    await expect(drainPromise).resolves.toEqual({
      conflicted: 0,
      failed: 0,
      processed: 1,
      synced: 0,
    })
    expect(onLifeSphereSynced).not.toHaveBeenCalled()
    await expect(loadCachedLifeSphereRecords(WORKSPACE_ID)).resolves.toEqual([])
    await expect(
      countRetryablePlannerOfflineMutations(WORKSPACE_ID),
    ).resolves.toBe(0)
    await expect(
      countConflictedPlannerOfflineMutations(WORKSPACE_ID),
    ).resolves.toBe(0)
  })
})

function createPlannerApiClientMock(
  overrides: Partial<PlannerApiClient>,
): PlannerApiClient {
  return {
    autoBuildDailyPlan: vi.fn(),
    closeTaskChain: vi.fn(),
    copyTaskToPersonal: vi.fn(),
    createLifeSphere: vi.fn(),
    createNextTaskStage: vi.fn(),
    createTask: vi.fn(),
    createTaskTemplate: vi.fn(),
    detachTaskFromChain: vi.fn(),
    getDailyPlan: vi.fn(),
    getLifeSphereWeeklyStats: vi.fn(),
    getTask: vi.fn(),
    getTaskReadModel: vi.fn(),
    listLifeSpheres: vi.fn(),
    listTaskEvents: vi.fn(),
    listTasks: vi.fn(),
    listTasksCursor: vi.fn(),
    listTasksPage: vi.fn(),
    listTaskTemplates: vi.fn(),
    removeLifeSphere: vi.fn(),
    moveTaskToPersonal: vi.fn(),
    removeTask: vi.fn(),
    removeTaskTemplate: vi.fn(),
    saveDailyPlan: vi.fn(),
    setTaskSchedule: vi.fn(),
    setTaskStatus: vi.fn(),
    undoCreateNextTaskStage: vi.fn(),
    updateLifeSphere: vi.fn(),
    updateTask: vi.fn(),
    unloadDailyPlan: vi.fn(),
    ...overrides,
  }
}

function createTaskRecord(taskId: string): TaskRecord {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: '2026-04-20T00:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    id: taskId,
    icon: '',
    importance: 'not_important',
    necessity: 'desired',
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    resource: null,
    requiresConfirmation: false,
    sphereId: null,
    status: 'todo',
    title: 'Offline task',
    urgency: 'not_urgent',
    updatedAt: '2026-04-20T00:00:00.000Z',
    version: 1,
    workspaceId: WORKSPACE_ID,
  }
}

function createTaskNextStageRecords() {
  const source = createTaskRecord('chain-current')
  const current: TaskRecord = {
    ...source,
    chainId: 'chain-1',
    completedAt: '2026-08-11T05:00:00.000Z',
    completionType: 'advanced',
    stageIndex: 1,
    stageType: 'task',
    status: 'done',
    version: 2,
  }
  const next: TaskRecord = {
    ...source,
    chainId: 'chain-1',
    id: 'chain-next',
    previousTaskId: source.id,
    stageIndex: 2,
    stageType: 'task',
    version: 1,
  }

  return {
    current,
    next,
    response: {
      currentTask: current,
      nextTask: next,
      undo: {
        createdTaskExpectedVersion: next.version,
        createdTaskId: next.id,
        previousChainId: null,
        previousCompletionType: null,
        previousCompletedAt: null,
        previousPreviousTaskId: null,
        previousStageIndex: null,
        previousStageType: null,
        previousStatus: source.status,
        previousTaskExpectedVersion: current.version,
      },
    },
    source,
  }
}

async function enqueueNextStageMutation(
  stage: ReturnType<typeof createTaskNextStageRecords>,
): Promise<void> {
  await enqueuePlannerOfflineMutation(
    {
      actorUserId: ACTOR_USER_ID,
      expectedVersion: stage.source.version,
      input: {
        chainId: 'chain-1',
        completeCurrent: true,
        expectedVersion: stage.source.version,
        nextTaskId: stage.next.id,
        plannedDate: null,
      },
      nextTaskId: stage.next.id,
      taskId: stage.source.id,
      type: 'task.next-stage',
      workspaceId: WORKSPACE_ID,
    },
    { optimisticTasks: [stage.current, stage.next] },
  )
}

function createLifeSphereRecord(sphereId: string): LifeSphereRecord {
  return {
    color: '#2f6f62',
    createdAt: '2026-04-20T00:00:00.000Z',
    deletedAt: null,
    description: 'Offline sphere',
    icon: 'folder',
    id: sphereId,
    isActive: true,
    isDefault: false,
    name: 'Offline sphere',
    sortOrder: 0,
    updatedAt: '2026-04-20T00:00:00.000Z',
    userId: ACTOR_USER_ID,
    version: 1,
    workspaceId: WORKSPACE_ID,
  }
}

function waitForNextMutationTimestamp(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 1)
  })
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}
