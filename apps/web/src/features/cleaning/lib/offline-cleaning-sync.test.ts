import 'fake-indexeddb/auto'

import type {
  CleaningListResponse,
  CleaningTaskRecord,
  CleaningZoneRecord,
} from '@planner/contracts'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type CleaningApiClient, CleaningApiError } from './cleaning-api'
import {
  CLEANING_OFFLINE_DATABASE_NAME,
  enqueueCleaningOfflineMutation,
  listCleaningOfflineMutations,
  loadCachedCleaningPlan,
  replaceCachedCleaningPlan,
  resetCleaningOfflineDatabaseForTests,
} from './offline-cleaning-store'
import { drainCleaningOfflineQueue } from './offline-cleaning-sync'

const WORKSPACE_ID = 'workspace-1'
const ACTOR_USER_ID = 'user-1'
const NOW = '2026-08-06T08:30:00.000Z'

describe('cleaning offline sync', () => {
  beforeEach(async () => {
    await resetCleaningOfflineDatabaseForTests()
  })

  it('replays a lost response with the same operation id and folds confirmation before dequeue', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      emptyPlan(),
      NOW,
    )
    const queued = await enqueueZoneCreate()
    const createZone = vi
      .fn<CleaningApiClient['createZone']>()
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(zoneRecord())
    const api = { createZone } as unknown as CleaningApiClient

    const first = await drainCleaningOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })
    const second = await drainCleaningOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(first.failed).toBe(1)
    expect(second.synced).toBe(1)
    expect(createZone).toHaveBeenCalledTimes(2)
    expect(createZone.mock.calls.map((call) => call[1]?.operationId)).toEqual([
      queued.operationId,
      queued.operationId,
    ])
    await expect(
      listCleaningOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toEqual([])
    expect(
      (await loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID))?.data.zones,
    ).toEqual([zoneRecord()])
  })

  it('keeps dependency order and does not send a task before its zone', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      emptyPlan(),
      NOW,
    )
    await enqueueZoneCreate()
    await enqueueCleaningOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      entityKeys: ['task:task-1', 'zone:zone-1'],
      input: taskInput(),
      taskId: 'task-1',
      type: 'task.create',
      workspaceId: WORKSPACE_ID,
    })
    const calls: string[] = []
    const api = {
      createTask: vi.fn(() => {
        calls.push('task')
        return Promise.resolve(taskRecord())
      }),
      createZone: vi.fn(() => {
        calls.push('zone')
        return Promise.resolve(zoneRecord())
      }),
    } as unknown as CleaningApiClient

    const result = await drainCleaningOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result.synced).toBe(2)
    expect(calls).toEqual(['zone', 'task'])
    expect(
      (await loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID))?.data.states,
    ).toEqual([
      expect.objectContaining({
        taskId: 'task-1',
        version: 1,
        workspaceId: WORKSPACE_ID,
      }),
    ])
  })

  it('does not treat an unknown dependency as already synchronized', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      emptyPlan(),
      NOW,
    )
    const queued = await enqueueZoneCreate()
    const rawDatabase = new Dexie(CLEANING_OFFLINE_DATABASE_NAME)
    await rawDatabase.open()
    await rawDatabase.table('mutationQueue').update(queued.sequence!, {
      dependsOnOperationIds: ['missing-operation'],
    })
    rawDatabase.close()
    const createZone = vi.fn<CleaningApiClient['createZone']>()

    const result = await drainCleaningOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api: { createZone } as unknown as CleaningApiClient,
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toMatchObject({ conflicted: 1, synced: 0 })
    expect(createZone).not.toHaveBeenCalled()
    expect(
      (await listCleaningOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID))[0],
    ).toMatchObject({
      lastError:
        'Не удалось подтвердить предыдущее связанное изменение. Обновите данные перед повтором.',
      status: 'conflicted',
    })
  })

  it('surfaces a legacy dependency cycle instead of leaving it pending forever', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      emptyPlan(),
      NOW,
    )
    const zone = await enqueueZoneCreate()
    const task = await enqueueCleaningOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      entityKeys: ['task:task-1', 'zone:zone-1'],
      input: taskInput(),
      taskId: 'task-1',
      type: 'task.create',
      workspaceId: WORKSPACE_ID,
    })
    const rawDatabase = new Dexie(CLEANING_OFFLINE_DATABASE_NAME)
    await rawDatabase.open()
    await rawDatabase.table('mutationQueue').update(zone.sequence!, {
      dependsOnOperationIds: [task.operationId],
    })
    rawDatabase.close()
    const createTask = vi.fn<CleaningApiClient['createTask']>()
    const createZone = vi.fn<CleaningApiClient['createZone']>()

    const result = await drainCleaningOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api: { createTask, createZone } as unknown as CleaningApiClient,
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toMatchObject({ conflicted: 2, synced: 0 })
    expect(createTask).not.toHaveBeenCalled()
    expect(createZone).not.toHaveBeenCalled()
    expect(
      (await listCleaningOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID)).map(
        (mutation) => mutation.status,
      ),
    ).toEqual(['conflicted', 'conflicted'])
  })

  it('syncs the final coalesced action with confirmed base versions', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      planWithTask(),
      NOW,
    )
    await enqueueCleaningOfflineMutation(actionMutation('completed', 1))
    await enqueueCleaningOfflineMutation(actionMutation('skipped', 2))
    const skipTask = vi.fn<CleaningApiClient['skipTask']>().mockResolvedValue({
      historyItem: {
        action: 'skipped',
        createdAt: NOW,
        date: '2026-08-06',
        id: 'history-1',
        note: '',
        targetDate: null,
        taskId: 'task-1',
        userId: ACTOR_USER_ID,
        workspaceId: WORKSPACE_ID,
        zoneId: 'zone-1',
      },
      state: {
        lastCompletedAt: null,
        lastPostponedAt: null,
        lastSkippedAt: NOW,
        nextDueAt: '2026-08-13',
        postponeCount: 0,
        taskId: 'task-1',
        updatedAt: NOW,
        version: 2,
        workspaceId: WORKSPACE_ID,
      },
    })

    const result = await drainCleaningOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api: { skipTask } as unknown as CleaningApiClient,
      workspaceId: WORKSPACE_ID,
    })

    expect(result.synced).toBe(1)
    expect(skipTask.mock.calls[0]?.[1]).toMatchObject({
      expectedStateVersion: 1,
      expectedTaskVersion: 1,
    })
    await expect(
      listCleaningOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toEqual([])
  })

  it('single-flights concurrent drains for the same actor and workspace', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      emptyPlan(),
      NOW,
    )
    await enqueueZoneCreate()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const createZone = vi.fn<CleaningApiClient['createZone']>(async () => {
      await gate
      return zoneRecord()
    })
    const api = { createZone } as unknown as CleaningApiClient
    const first = drainCleaningOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })
    const second = drainCleaningOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    await vi.waitFor(() => {
      expect(createZone).toHaveBeenCalledTimes(1)
    })
    release()

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ synced: 1 }),
      expect.objectContaining({ synced: 1 }),
    ])
    expect(createZone).toHaveBeenCalledTimes(1)
  })

  it.each([400, 403, 404, 409])(
    'marks non-retryable HTTP %s as a terminal conflict',
    async (status) => {
      await replaceCachedCleaningPlan(
        WORKSPACE_ID,
        ACTOR_USER_ID,
        emptyPlan(),
        NOW,
      )
      await enqueueZoneCreate()
      const api = {
        createZone: vi.fn(() =>
          Promise.reject(
            new CleaningApiError('terminal', {
              code: 'terminal',
              status,
            }),
          ),
        ),
      } as unknown as CleaningApiClient

      const result = await drainCleaningOfflineQueue({
        actorUserId: ACTOR_USER_ID,
        api,
        workspaceId: WORKSPACE_ID,
      })

      expect(result.conflicted).toBe(1)
      expect(
        (await listCleaningOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID))[0]
          ?.status,
      ).toBe('conflicted')
    },
  )

  it.each([401, 408, 425, 429, 500])(
    'retains retryable HTTP %s for a later drain',
    async (status) => {
      await replaceCachedCleaningPlan(
        WORKSPACE_ID,
        ACTOR_USER_ID,
        emptyPlan(),
        NOW,
      )
      await enqueueZoneCreate()
      const api = {
        createZone: vi.fn(() =>
          Promise.reject(
            new CleaningApiError('retryable', {
              code: 'retryable',
              status,
            }),
          ),
        ),
      } as unknown as CleaningApiClient

      const result = await drainCleaningOfflineQueue({
        actorUserId: ACTOR_USER_ID,
        api,
        workspaceId: WORKSPACE_ID,
      })

      expect(result.failed).toBe(1)
      expect(result.unauthorized).toBe(status === 401)
      expect(
        (await listCleaningOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID))[0]
          ?.status,
      ).toBe('failed')
    },
  )
})

function enqueueZoneCreate() {
  return enqueueCleaningOfflineMutation({
    actorUserId: ACTOR_USER_ID,
    entityKeys: ['zone:zone-1'],
    input: {
      dayOfWeek: 4,
      description: '',
      id: 'zone-1',
      isActive: true,
      title: 'Кухня',
    },
    type: 'zone.create',
    workspaceId: WORKSPACE_ID,
    zoneId: 'zone-1',
  })
}

function emptyPlan(): CleaningListResponse {
  return { history: [], states: [], tasks: [], zones: [] }
}

function zoneRecord(): CleaningZoneRecord {
  return {
    createdAt: NOW,
    dayOfWeek: 4,
    deletedAt: null,
    description: '',
    id: 'zone-1',
    isActive: true,
    sortOrder: 0,
    title: 'Кухня',
    updatedAt: NOW,
    userId: ACTOR_USER_ID,
    version: 1,
    workspaceId: WORKSPACE_ID,
  }
}

function taskInput() {
  return {
    assignee: 'anyone' as const,
    customIntervalDays: null,
    depth: 'regular' as const,
    description: '',
    energy: 'normal' as const,
    estimatedMinutes: 15,
    frequencyInterval: 1,
    frequencyType: 'weekly' as const,
    id: 'task-1',
    impactScore: 3,
    isActive: true,
    isSeasonal: false,
    priority: 'normal' as const,
    scope: 'zone' as const,
    seasonMonths: [],
    tags: [],
    title: 'Пылесос',
    zoneId: 'zone-1',
  }
}

function taskRecord(): CleaningTaskRecord {
  return {
    ...taskInput(),
    createdAt: NOW,
    deletedAt: null,
    sortOrder: 0,
    updatedAt: NOW,
    userId: ACTOR_USER_ID,
    version: 1,
    workspaceId: WORKSPACE_ID,
  }
}

function planWithTask(): CleaningListResponse {
  return {
    history: [],
    states: [
      {
        lastCompletedAt: null,
        lastPostponedAt: null,
        lastSkippedAt: null,
        nextDueAt: null,
        postponeCount: 0,
        taskId: 'task-1',
        updatedAt: NOW,
        version: 1,
        workspaceId: WORKSPACE_ID,
      },
    ],
    tasks: [taskRecord()],
    zones: [zoneRecord()],
  }
}

function actionMutation(
  action: 'completed' | 'skipped',
  expectedStateVersion: number,
) {
  return {
    action,
    actorUserId: ACTOR_USER_ID,
    entityKeys: ['task:task-1'],
    expectedStateVersion,
    expectedTaskVersion: 1,
    input: {
      date: '2026-08-06',
      mode: 'next_cycle' as const,
      note: '',
      occurredAt: NOW,
      targetDate: null,
    },
    taskId: 'task-1',
    type: 'task.action' as const,
    workspaceId: WORKSPACE_ID,
  }
}
