import 'fake-indexeddb/auto'

import type {
  NewProjectInput,
  NewTaskInput,
  ProjectRecord,
  TaskRecord,
} from '@planner/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  countConflictedPlannerOfflineMutations,
  countRetryablePlannerOfflineMutations,
  enqueuePlannerOfflineMutation,
  loadCachedProjectRecords,
  loadCachedTaskRecords,
  resetPlannerOfflineDatabaseForTests,
} from './offline-planner-store'
import { drainPlannerOfflineQueue } from './offline-planner-sync'
import { type PlannerApiClient, PlannerApiError } from './planner-api'

const WORKSPACE_ID = 'workspace-1'
const ACTOR_USER_ID = 'user-1'

const createInput: NewTaskInput = {
  dueDate: null,
  id: '01963dd0-7f58-7de6-9c7f-9a5f7bdfd8b2',
  note: '',
  plannedDate: null,
  plannedEndTime: null,
  plannedStartTime: null,
  project: '',
  projectId: null,
  resource: null,
  sphereId: null,
  title: 'Offline task',
}

const createProjectInput: NewProjectInput = {
  color: '#2f6f62',
  description: 'Offline project',
  icon: 'folder',
  id: '01963dd0-7f58-7de6-9c7f-9a5f7bdfd8b3',
  title: 'Offline project',
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
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result.conflicted).toBe(1)
    expect(await countRetryablePlannerOfflineMutations(WORKSPACE_ID)).toBe(0)
    expect(await countConflictedPlannerOfflineMutations(WORKSPACE_ID)).toBe(1)
  })

  it('replays queued project creates through the API and caches the server record', async () => {
    const projectRecord = createProjectRecord(createProjectInput.id!)
    const api = createPlannerApiClientMock({
      createProject: vi.fn().mockResolvedValue(projectRecord),
    })

    await enqueuePlannerOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      input: createProjectInput,
      projectId: createProjectInput.id!,
      type: 'project.create',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainPlannerOfflineQueue({
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result.synced).toBe(1)
    expect(api.createProject).toHaveBeenCalledWith(createProjectInput)
    expect(await countRetryablePlannerOfflineMutations(WORKSPACE_ID)).toBe(0)
    expect(await loadCachedProjectRecords(WORKSPACE_ID)).toEqual([
      projectRecord,
    ])
  })
})

function createPlannerApiClientMock(
  overrides: Partial<PlannerApiClient>,
): PlannerApiClient {
  return {
    autoBuildDailyPlan: vi.fn(),
    bulkConvertChaosInboxItemsToTasks: vi.fn(),
    bulkDeleteChaosInboxItems: vi.fn(),
    bulkUpdateChaosInboxItems: vi.fn(),
    convertChaosInboxItemToTask: vi.fn(),
    createChaosInboxItems: vi.fn(),
    createLifeSphere: vi.fn(),
    createProject: vi.fn(),
    createTask: vi.fn(),
    createTaskTemplate: vi.fn(),
    getDailyPlan: vi.fn(),
    getLifeSphereWeeklyStats: vi.fn(),
    getProject: vi.fn(),
    listChaosInboxItems: vi.fn(),
    listLifeSpheres: vi.fn(),
    listTaskEvents: vi.fn(),
    listProjects: vi.fn(),
    listTasks: vi.fn(),
    listTaskTemplates: vi.fn(),
    removeChaosInboxItem: vi.fn(),
    removeLifeSphere: vi.fn(),
    removeTask: vi.fn(),
    removeTaskTemplate: vi.fn(),
    saveDailyPlan: vi.fn(),
    setTaskSchedule: vi.fn(),
    setTaskStatus: vi.fn(),
    updateProject: vi.fn(),
    updateChaosInboxItem: vi.fn(),
    updateLifeSphere: vi.fn(),
    updateTask: vi.fn(),
    unloadDailyPlan: vi.fn(),
    ...overrides,
  }
}

function createTaskRecord(taskId: string): TaskRecord {
  return {
    completedAt: null,
    createdAt: '2026-04-20T00:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    id: taskId,
    icon: '',
    importance: 'not_important',
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    resource: null,
    sphereId: null,
    status: 'todo',
    title: 'Offline task',
    urgency: 'not_urgent',
    updatedAt: '2026-04-20T00:00:00.000Z',
    version: 1,
    workspaceId: WORKSPACE_ID,
  }
}

function createProjectRecord(projectId: string): ProjectRecord {
  return {
    color: '#2f6f62',
    createdAt: '2026-04-20T00:00:00.000Z',
    deletedAt: null,
    description: 'Offline project',
    icon: 'folder',
    id: projectId,
    status: 'active',
    title: 'Offline project',
    updatedAt: '2026-04-20T00:00:00.000Z',
    version: 1,
    workspaceId: WORKSPACE_ID,
  }
}
