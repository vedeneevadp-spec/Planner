import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  loadCachedProjectRecords,
  loadCachedTaskRecords,
  PLANNER_OFFLINE_DATABASE_NAME,
  PLANNER_OFFLINE_SCHEMA_VERSION,
  replaceCachedProjectRecords,
  replaceCachedTaskRecords,
  replaceCachedTaskTemplateRecords,
  resetPlannerOfflineDatabaseForTests,
} from './offline-planner-store'

describe('offline planner storage migrations', () => {
  beforeEach(async () => {
    await resetPlannerOfflineDatabaseForTests()
  })

  it('keeps the current schema version explicit and writable', async () => {
    expect(PLANNER_OFFLINE_DATABASE_NAME).toBe('planner-offline')
    expect(PLANNER_OFFLINE_SCHEMA_VERSION).toBe(3)

    await replaceCachedTaskRecords('workspace-1', [])
    await replaceCachedProjectRecords('workspace-1', [])
    await replaceCachedTaskTemplateRecords('workspace-1', [])

    const db = new Dexie(PLANNER_OFFLINE_DATABASE_NAME)
    await db.open()

    expect(db.verno).toBe(PLANNER_OFFLINE_SCHEMA_VERSION)

    db.close()
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

    await replaceCachedProjectRecords('workspace-1', [
      {
        color: '#214e42',
        createdAt: '2026-04-20T08:00:00.000Z',
        deletedAt: null,
        description: '',
        icon: 'folder',
        id: 'project-1',
        status: 'active',
        title: 'Cached sphere',
        updatedAt: '2026-04-20T08:00:00.000Z',
        version: 1,
        workspaceId: 'workspace-1',
      },
    ])

    expect(await loadCachedTaskRecords('workspace-1')).toHaveLength(1)
    expect(await loadCachedProjectRecords('workspace-1')).toHaveLength(1)
  })
})
