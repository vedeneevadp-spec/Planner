import 'fake-indexeddb/auto'

import type {
  LifeSphereRecord,
  NewLifeSphereInput,
  NewTaskInput,
  TaskRecord,
} from '@planner/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  countConflictedPlannerOfflineMutations,
  countRetryablePlannerOfflineMutations,
  enqueuePlannerOfflineMutation,
  loadCachedLifeSphereRecords,
  loadCachedTaskRecords,
  resetPlannerOfflineDatabaseForTests,
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
    listLifeSpheres: vi.fn(),
    listTaskEvents: vi.fn(),
    listTasks: vi.fn(),
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
