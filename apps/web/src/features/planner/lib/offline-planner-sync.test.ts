import 'fake-indexeddb/auto'

import type { NewTaskInput, TaskRecord } from '@planner/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  countConflictedPlannerOfflineMutations,
  countRetryablePlannerOfflineMutations,
  enqueuePlannerOfflineMutation,
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
  title: 'Offline task',
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
})

function createPlannerApiClientMock(
  overrides: Partial<PlannerApiClient>,
): PlannerApiClient {
  return {
    createTask: vi.fn(),
    listTaskEvents: vi.fn(),
    listTasks: vi.fn(),
    removeTask: vi.fn(),
    setTaskSchedule: vi.fn(),
    setTaskStatus: vi.fn(),
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
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    status: 'todo',
    title: 'Offline task',
    updatedAt: '2026-04-20T00:00:00.000Z',
    version: 1,
    workspaceId: WORKSPACE_ID,
  }
}
