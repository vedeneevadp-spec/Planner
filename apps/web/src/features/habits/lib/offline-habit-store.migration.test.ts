import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  HABIT_OFFLINE_DATABASE_NAME,
  HABIT_OFFLINE_SCHEMA_VERSION,
  loadCachedHabitRecords,
  replaceCachedHabitRecords,
  resetHabitOfflineDatabaseForTests,
} from './offline-habit-store'

describe('offline habit storage migrations', () => {
  beforeEach(async () => {
    await resetHabitOfflineDatabaseForTests()
  })

  it('keeps the current schema version explicit and writable', async () => {
    expect(HABIT_OFFLINE_DATABASE_NAME).toBe('habit-offline')
    expect(HABIT_OFFLINE_SCHEMA_VERSION).toBe(1)

    await replaceCachedHabitRecords('workspace-1', [])

    const db = new Dexie(HABIT_OFFLINE_DATABASE_NAME)
    await db.open()

    expect(db.verno).toBe(HABIT_OFFLINE_SCHEMA_VERSION)

    db.close()
  })

  it('keeps cached habit rows readable after opening the current schema', async () => {
    await replaceCachedHabitRecords('workspace-1', [
      {
        color: '#2f6f62',
        createdAt: '2026-05-11T00:00:00.000Z',
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        deletedAt: null,
        description: '',
        endDate: null,
        frequency: 'daily',
        icon: 'check',
        id: 'habit-1',
        isActive: true,
        reminderTime: null,
        sortOrder: 0,
        sphereId: null,
        startDate: '2026-05-11',
        targetType: 'check',
        targetValue: 1,
        title: 'Cached habit',
        unit: '',
        updatedAt: '2026-05-11T00:00:00.000Z',
        userId: 'user-1',
        version: 1,
        workspaceId: 'workspace-1',
      },
    ])

    expect(await loadCachedHabitRecords('workspace-1')).toHaveLength(1)
  })
})
