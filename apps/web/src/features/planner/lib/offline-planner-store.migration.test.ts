import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearPlannerOfflineWorkspaceData,
  getPlannerDataLastSuccessfulSyncAt,
  getPlannerOfflineWorkspaceWriteGeneration,
  loadCachedLifeSphereRecords,
  loadCachedTaskRecords,
  PLANNER_OFFLINE_DATABASE_NAME,
  PLANNER_OFFLINE_SCHEMA_VERSION,
  replaceCachedLifeSphereRecords,
  replaceCachedTaskRecords,
  replaceCachedTaskRecordsFromServer,
  replaceCachedTaskTemplateRecords,
  resetPlannerOfflineDatabaseForTests,
  setPlannerDataLastSuccessfulSyncAt,
} from './offline-planner-store'

describe('offline planner storage migrations', () => {
  beforeEach(async () => {
    await resetPlannerOfflineDatabaseForTests()
  })

  it('keeps the current schema version explicit and writable', async () => {
    expect(PLANNER_OFFLINE_DATABASE_NAME).toBe('planner-offline')
    expect(PLANNER_OFFLINE_SCHEMA_VERSION).toBe(5)

    await replaceCachedTaskRecords('workspace-1', [])
    await replaceCachedLifeSphereRecords('workspace-1', [])
    await replaceCachedTaskTemplateRecords('workspace-1', [])

    const db = new Dexie(PLANNER_OFFLINE_DATABASE_NAME)
    await db.open()

    expect(db.verno).toBe(PLANNER_OFFLINE_SCHEMA_VERSION)

    db.close()
  })

  it('upgrades version 4 caches without losing records', async () => {
    const legacyDatabase = new Dexie(PLANNER_OFFLINE_DATABASE_NAME)
    legacyDatabase.version(4).stores({
      cachedLifeSpheres: 'key, workspaceId, sphereId, updatedAt',
      cachedTaskTemplates: 'key, workspaceId, templateId, updatedAt',
      cachedTasks: 'key, workspaceId, taskId, updatedAt',
      mutationQueue: 'id, workspaceId, status, createdAt, updatedAt',
      syncMetadata: 'key, workspaceId, updatedAt',
    })
    await legacyDatabase.open()
    await legacyDatabase.table('cachedTasks').put({
      key: 'workspace-1:task-legacy',
      task: createCachedTask('task-legacy'),
      taskId: 'task-legacy',
      updatedAt: '2026-04-20T08:00:00.000Z',
      workspaceId: 'workspace-1',
    })
    legacyDatabase.close()

    await setPlannerDataLastSuccessfulSyncAt(
      'workspace-1',
      'tasks',
      '2026-08-06T08:30:00.000Z',
    )

    expect(await loadCachedTaskRecords('workspace-1')).toEqual([
      createCachedTask('task-legacy'),
    ])
    expect(
      await getPlannerDataLastSuccessfulSyncAt('workspace-1', 'tasks'),
    ).toBe('2026-08-06T08:30:00.000Z')
  })

  it('keeps existing task rows readable after opening the current schema', async () => {
    await replaceCachedTaskRecords('workspace-1', [
      {
        assigneeDisplayName: null,
        assigneeUserId: null,
        authorDisplayName: null,
        authorUserId: null,
        completedAt: null,
        createdAt: '2026-04-20T08:00:00.000Z',
        deletedAt: null,
        dueDate: null,
        icon: '',
        id: 'task-1',
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
        title: 'Cached task',
        updatedAt: '2026-04-20T08:00:00.000Z',
        urgency: 'not_urgent',
        version: 1,
        workspaceId: 'workspace-1',
      },
    ])

    await replaceCachedLifeSphereRecords('workspace-1', [
      {
        color: '#214e42',
        createdAt: '2026-04-20T08:00:00.000Z',
        deletedAt: null,
        description: '',
        icon: 'folder',
        id: 'project-1',
        isActive: true,
        isDefault: false,
        name: 'Cached sphere',
        sortOrder: 0,
        updatedAt: '2026-04-20T08:00:00.000Z',
        userId: 'user-1',
        version: 1,
        workspaceId: 'workspace-1',
      },
    ])

    expect(await loadCachedTaskRecords('workspace-1')).toHaveLength(1)
    expect(await loadCachedLifeSphereRecords('workspace-1')).toHaveLength(1)
  })

  it('does not resurrect a server snapshot returned after workspace cleanup', async () => {
    const requestGeneration =
      getPlannerOfflineWorkspaceWriteGeneration('workspace-1')

    await clearPlannerOfflineWorkspaceData('workspace-1')
    await replaceCachedTaskRecordsFromServer(
      'workspace-1',
      [createCachedTask('late-task')],
      '2026-08-06T09:00:00.000Z',
      requestGeneration,
    )

    await expect(loadCachedTaskRecords('workspace-1')).resolves.toEqual([])
    await expect(
      getPlannerDataLastSuccessfulSyncAt('workspace-1', 'tasks'),
    ).resolves.toBeNull()
  })
})

function createCachedTask(taskId: string) {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: '2026-04-20T08:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    icon: '',
    id: taskId,
    importance: 'not_important' as const,
    necessity: 'desired' as const,
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    requiresConfirmation: false,
    resource: null,
    sphereId: null,
    status: 'todo' as const,
    title: 'Cached task',
    updatedAt: '2026-04-20T08:00:00.000Z',
    urgency: 'not_urgent' as const,
    version: 1,
    workspaceId: 'workspace-1',
  }
}
