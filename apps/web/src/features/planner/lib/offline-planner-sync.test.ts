import 'fake-indexeddb/auto'

import type {
  LifeSphereRecord,
  NewLifeSphereInput,
  NewTaskInput,
  TaskRecord,
  TaskUpdateInput,
} from '@planner/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearPlannerOfflineWorkspaceData,
  countConflictedPlannerOfflineMutations,
  countRetryablePlannerOfflineMutations,
  enqueuePlannerOfflineMutation,
  getLastTaskEventId,
  getPlannerDataLastSuccessfulSyncAt,
  listPlannerOfflineMutations,
  loadCachedLifeSphereRecords,
  loadCachedTaskRecords,
  replaceCachedTaskRecords,
  replaceCachedTaskRecordsFromServer,
  resetPlannerOfflineDatabaseForTests,
  resolvePlannerOfflineConflict,
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

const updateInput: TaskUpdateInput = {
  assigneeUserId: null,
  dueDate: null,
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

  it.each([400, 403, 409, 422])(
    'retains a permanent %s refusal without poisoning independent commands or later drains',
    async (status) => {
      const refused = await enqueuePlannerOfflineMutation({
        actorUserId: ACTOR_USER_ID,
        workspaceId: WORKSPACE_ID,
        type: 'task.update',
        taskId: 'refused',
        expectedVersion: 3,
        input: {
          ...updateInput,
          title: 'Сохранить ввод',
          note: 'Важная заметка',
        },
      })
      await enqueuePlannerOfflineMutation({
        actorUserId: ACTOR_USER_ID,
        workspaceId: WORKSPACE_ID,
        type: 'task.status.update',
        taskId: 'independent',
        expectedVersion: 1,
        statusValue: 'done',
      })
      const api = createPlannerApiClientMock({
        updateTask: vi.fn().mockRejectedValue(
          new PlannerApiError('Изменение отклонено', {
            status,
            code: 'task_manage_forbidden',
          }),
        ),
        setTaskStatus: vi
          .fn()
          .mockResolvedValue(createTaskRecord('independent')),
      })
      expect(
        await drainPlannerOfflineQueue({
          actorUserId: ACTOR_USER_ID,
          workspaceId: WORKSPACE_ID,
          api,
        }),
      ).toEqual({ conflicted: 1, failed: 0, processed: 2, synced: 1 })
      await drainPlannerOfflineQueue({
        actorUserId: ACTOR_USER_ID,
        workspaceId: WORKSPACE_ID,
        api,
      })
      expect(api.updateTask).toHaveBeenCalledTimes(1)
      expect(api.setTaskStatus).toHaveBeenCalledTimes(1)
      expect(
        await listPlannerOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
      ).toEqual([
        expect.objectContaining({
          id: refused?.id,
          status: 'conflicted',
          conflictCode: 'task_manage_forbidden',
          attemptCount: 1,
          expectedVersion: 3,
          input: {
            ...updateInput,
            title: 'Сохранить ввод',
            note: 'Важная заметка',
          },
        }),
      ])
    },
  )

  it.each([401, 408, 429, 500, 503])(
    'preserves queue ordering during a transient %s response',
    async (status) => {
      for (const taskId of ['first', 'second'])
        await enqueuePlannerOfflineMutation({
          actorUserId: ACTOR_USER_ID,
          workspaceId: WORKSPACE_ID,
          type: 'task.status.update',
          taskId,
          expectedVersion: 1,
          statusValue: 'done',
        })
      const api = createPlannerApiClientMock({
        setTaskStatus: vi.fn().mockRejectedValue(
          new PlannerApiError('Попробуйте позже', {
            status,
            code: 'unavailable',
          }),
        ),
      })
      expect(
        await drainPlannerOfflineQueue({
          actorUserId: ACTOR_USER_ID,
          workspaceId: WORKSPACE_ID,
          api,
        }),
      ).toEqual({ conflicted: 0, failed: 1, processed: 1, synced: 0 })
      expect(api.setTaskStatus).toHaveBeenCalledTimes(1)
      expect(
        (await listPlannerOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID)).map(
          ({ status, attemptCount }) => ({ status, attemptCount }),
        ),
      ).toEqual([
        { status: 'failed', attemptCount: 1 },
        { status: 'pending', attemptCount: 0 },
      ])
    },
  )

  it('blocks a refused create, its next stage and later edits across drains; retry preserves the entire sequence', async () => {
    const stage = createTaskNextStageRecords()
    const root = await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      type: 'task.create',
      taskId: stage.source.id,
      input: { ...createInput, id: stage.source.id },
    })
    await waitForNextMutationTimestamp()
    await enqueueNextStageMutation(stage)
    const api = createPlannerApiClientMock({
      createTask: vi.fn().mockRejectedValue(
        new PlannerApiError('Отклонено', {
          status: 403,
          code: 'task_manage_forbidden',
        }),
      ),
      createNextTaskStage: vi.fn().mockResolvedValue(stage.response),
      updateTask: vi.fn().mockResolvedValue(stage.next),
      setTaskStatus: vi.fn().mockResolvedValue(createTaskRecord('independent')),
    })
    await drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      api,
    })
    await waitForNextMutationTimestamp()
    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      type: 'task.update',
      taskId: stage.next.id,
      expectedVersion: 1,
      input: { ...updateInput, note: 'Следующий этап: сохранить' },
    })
    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      type: 'task.status.update',
      taskId: 'independent',
      expectedVersion: 1,
      statusValue: 'done',
    })
    await drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      api,
    })
    expect(api.createTask).toHaveBeenCalledTimes(1)
    expect(api.createNextTaskStage).not.toHaveBeenCalled()
    expect(api.updateTask).not.toHaveBeenCalled()
    expect(api.setTaskStatus).toHaveBeenCalledTimes(1)
    const saved = await listPlannerOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID)
    expect(
      saved.map(({ status, attemptCount }) => ({ status, attemptCount })),
    ).toEqual([
      { status: 'conflicted', attemptCount: 1 },
      { status: 'conflicted', attemptCount: 0 },
      { status: 'conflicted', attemptCount: 0 },
    ])
    await resolvePlannerOfflineConflict(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      root!.id,
      'retry',
    )
    const retried = await listPlannerOfflineMutations(
      WORKSPACE_ID,
      ACTOR_USER_ID,
    )
    expect(
      retried.map(({ id, createdAt, type }) => ({ id, createdAt, type })),
    ).toEqual(saved.map(({ id, createdAt, type }) => ({ id, createdAt, type })))
    expect(retried.every(({ status }) => status === 'pending')).toBe(true)
    vi.mocked(api.createTask).mockResolvedValue(stage.source)
    await drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      api,
    })
    expect(api.createNextTaskStage).toHaveBeenCalledWith(
      stage.source.id,
      expect.objectContaining({ expectedVersion: 1 }),
    )
    expect(api.updateTask).toHaveBeenCalledWith(stage.next.id, {
      ...updateInput,
      expectedVersion: 1,
      note: 'Следующий этап: сохранить',
    })
    expect(
      await listPlannerOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
    ).toEqual([])
  })

  it('blocks task references to a refused sphere and discards only its dependent group for the current actor', async () => {
    const root = await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      type: 'lifeSphere.create',
      sphereId: createSphereInput.id!,
      input: createSphereInput,
    })
    await waitForNextMutationTimestamp()
    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      type: 'task.create',
      taskId: 'dependent',
      input: {
        ...createInput,
        id: 'dependent',
        sphereId: createSphereInput.id!,
      },
    })
    await enqueuePlannerOfflineMutation({
      actorUserId: 'other-user',
      workspaceId: WORKSPACE_ID,
      type: 'task.create',
      taskId: 'other-actor',
      input: {
        ...createInput,
        id: 'other-actor',
        sphereId: createSphereInput.id!,
      },
    })
    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      type: 'task.create',
      taskId: 'independent',
      input: { ...createInput, id: 'independent' },
    })
    const api = createPlannerApiClientMock({
      createLifeSphere: vi.fn().mockRejectedValue(
        new PlannerApiError('Ошибка данных', {
          status: 400,
          code: 'invalid_request',
        }),
      ),
      createTask: vi.fn().mockResolvedValue(createTaskRecord('independent')),
    })
    await drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      api,
    })
    expect(api.createTask).toHaveBeenCalledTimes(1)
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'independent' }),
    )
    await resolvePlannerOfflineConflict(
      WORKSPACE_ID,
      'other-user',
      root!.id,
      'discard',
    )
    expect(
      await countConflictedPlannerOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
    ).toBe(2)
    await resolvePlannerOfflineConflict(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      root!.id,
      'discard',
    )
    expect(
      await listPlannerOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
    ).toEqual([])
    expect(
      await listPlannerOfflineMutations(WORKSPACE_ID, 'other-user'),
    ).toHaveLength(1)
  })

  it('does not block a task referencing an existing sphere whose edit was refused', async () => {
    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      type: 'lifeSphere.update',
      sphereId: createSphereInput.id!,
      input: { ...createSphereInput, expectedVersion: 1 },
    })
    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      type: 'task.create',
      taskId: 'independent',
      input: {
        ...createInput,
        id: 'independent',
        sphereId: createSphereInput.id!,
      },
    })
    const api = createPlannerApiClientMock({
      updateLifeSphere: vi.fn().mockRejectedValue(
        new PlannerApiError('Версия сферы изменилась', {
          status: 409,
          code: 'life_sphere_version_conflict',
        }),
      ),
      createTask: vi.fn().mockResolvedValue(createTaskRecord('independent')),
    })
    expect(
      await drainPlannerOfflineQueue({
        actorUserId: ACTOR_USER_ID,
        workspaceId: WORKSPACE_ID,
        api,
      }),
    ).toEqual({ conflicted: 1, failed: 0, processed: 2, synced: 1 })
    expect(api.createTask).toHaveBeenCalledTimes(1)
  })

  it('keeps original versions when retrying a conflict and blocks a later same-task edit', async () => {
    const root = await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      type: 'task.update',
      taskId: 'stale',
      input: { ...updateInput, title: 'Мой заголовок' },
      expectedVersion: 2,
    })
    await waitForNextMutationTimestamp()
    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      type: 'task.status.update',
      taskId: 'stale',
      statusValue: 'done',
      expectedVersion: 3,
    })
    const api = createPlannerApiClientMock({
      updateTask: vi.fn().mockRejectedValue(
        new PlannerApiError('Версия изменилась', {
          status: 409,
          code: 'task_version_conflict',
          details: { actualVersion: 5, expectedVersion: 2 },
        }),
      ),
    })
    await drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      api,
    })
    await resolvePlannerOfflineConflict(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      root!.id,
      'retry',
    )
    await drainPlannerOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      api,
    })
    expect(api.updateTask).toHaveBeenCalledTimes(2)
    expect(api.updateTask).toHaveBeenLastCalledWith('stale', {
      ...updateInput,
      title: 'Мой заголовок',
      expectedVersion: 2,
    })
    expect(api.setTaskStatus).not.toHaveBeenCalled()
    expect(
      await countConflictedPlannerOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
    ).toBe(2)
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
