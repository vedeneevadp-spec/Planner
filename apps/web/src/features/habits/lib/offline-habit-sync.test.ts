import 'fake-indexeddb/auto'

import type {
  HabitEntryUpsertInput,
  HabitRecord,
  NewHabitInput,
} from '@planner/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type HabitsApiClient, HabitsApiError } from './habits-api'
import {
  countConflictedHabitOfflineMutations,
  countRetryableHabitOfflineMutations,
  enqueueHabitOfflineMutation,
  listRetryableHabitOfflineMutations,
  loadCachedHabitRecords,
  resetHabitOfflineDatabaseForTests,
} from './offline-habit-store'
import { drainHabitOfflineQueue } from './offline-habit-sync'

const WORKSPACE_ID = 'workspace-1'
const ACTOR_USER_ID = 'user-1'
const HABIT_ID = '01963dd0-7f58-7de6-9c7f-9a5f7bdfd8b2'

const createInput: NewHabitInput = {
  color: '#2f6f62',
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  description: '',
  endDate: null,
  frequency: 'daily',
  icon: 'check',
  id: HABIT_ID,
  reminderTime: null,
  sortOrder: 0,
  sphereId: null,
  startDate: '2026-05-11',
  targetType: 'check',
  targetValue: 1,
  title: 'Offline habit',
  unit: '',
}

describe('offline habit sync', () => {
  beforeEach(async () => {
    await resetHabitOfflineDatabaseForTests()
  })

  it('replays queued habit creates through the API and caches the server record', async () => {
    const habitRecord = createHabitRecord(HABIT_ID)
    const api = createHabitsApiClientMock({
      createHabit: vi.fn().mockResolvedValue(habitRecord),
    })

    await enqueueHabitOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      habitId: HABIT_ID,
      input: createInput,
      type: 'habit.create',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainHabitOfflineQueue({
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toEqual({
      conflicted: 0,
      failed: 0,
      processed: 1,
      synced: 1,
    })
    expect(api.createHabit).toHaveBeenCalledWith(createInput)
    expect(await countRetryableHabitOfflineMutations(WORKSPACE_ID)).toBe(0)
    expect(await loadCachedHabitRecords(WORKSPACE_ID)).toEqual([habitRecord])
  })

  it('marks stale entry changes as conflicted and leaves later mutations retryable', async () => {
    const api = createHabitsApiClientMock({
      upsertEntry: vi.fn().mockRejectedValue(
        new HabitsApiError('Habit entry version conflict.', {
          code: 'habit_entry_version_conflict',
          details: {
            actualVersion: 3,
            expectedVersion: 1,
          },
          status: 409,
        }),
      ),
    })

    await enqueueHabitOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      date: '2026-05-11',
      habitId: HABIT_ID,
      input: {
        date: '2026-05-11',
        expectedVersion: 1,
        note: '',
        status: 'done',
        value: 1,
      },
      type: 'habit.entry.upsert',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainHabitOfflineQueue({
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result.conflicted).toBe(1)
    expect(await countRetryableHabitOfflineMutations(WORKSPACE_ID)).toBe(0)
    expect(await countConflictedHabitOfflineMutations(WORKSPACE_ID)).toBe(1)
  })

  it('folds create and update into one idempotent create when possible', async () => {
    await enqueueHabitOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      habitId: HABIT_ID,
      input: createInput,
      type: 'habit.create',
      workspaceId: WORKSPACE_ID,
    })
    await enqueueHabitOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      habitId: HABIT_ID,
      input: {
        expectedVersion: 1,
        title: 'Edited habit',
      },
      type: 'habit.update',
      workspaceId: WORKSPACE_ID,
    })

    const mutations = await listRetryableHabitOfflineMutations(WORKSPACE_ID)

    expect(mutations).toHaveLength(1)
    expect(mutations[0]).toMatchObject({
      habitId: HABIT_ID,
      input: {
        title: 'Edited habit',
      },
      type: 'habit.create',
    })
  })

  it('cancels a locally created habit when it is deleted before replay', async () => {
    await enqueueHabitOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      habitId: HABIT_ID,
      input: createInput,
      type: 'habit.create',
      workspaceId: WORKSPACE_ID,
    })
    await enqueueHabitOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      habitId: HABIT_ID,
      type: 'habit.delete',
      workspaceId: WORKSPACE_ID,
    })

    expect(await listRetryableHabitOfflineMutations(WORKSPACE_ID)).toEqual([])
  })

  it('keeps only the latest entry upsert while preserving the server base version', async () => {
    await enqueueHabitOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      date: '2026-05-11',
      habitId: HABIT_ID,
      input: createEntryInput({
        expectedVersion: 3,
        status: 'done',
        value: 1,
      }),
      type: 'habit.entry.upsert',
      workspaceId: WORKSPACE_ID,
    })
    await enqueueHabitOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      date: '2026-05-11',
      habitId: HABIT_ID,
      input: createEntryInput({
        expectedVersion: 4,
        status: 'skipped',
        value: 0,
      }),
      type: 'habit.entry.upsert',
      workspaceId: WORKSPACE_ID,
    })

    const mutations = await listRetryableHabitOfflineMutations(WORKSPACE_ID)

    expect(mutations).toHaveLength(1)
    expect(mutations[0]).toMatchObject({
      input: {
        expectedVersion: 3,
        status: 'skipped',
        value: 0,
      },
      type: 'habit.entry.upsert',
    })
  })

  it('cancels a local entry create when the entry is removed before replay', async () => {
    await enqueueHabitOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      date: '2026-05-11',
      habitId: HABIT_ID,
      input: createEntryInput({
        status: 'done',
        value: 1,
      }),
      type: 'habit.entry.upsert',
      workspaceId: WORKSPACE_ID,
    })
    await enqueueHabitOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      date: '2026-05-11',
      habitId: HABIT_ID,
      input: {
        expectedVersion: 1,
      },
      type: 'habit.entry.delete',
      workspaceId: WORKSPACE_ID,
    })

    expect(await listRetryableHabitOfflineMutations(WORKSPACE_ID)).toEqual([])
  })
})

function createHabitsApiClientMock(
  overrides: Partial<HabitsApiClient>,
): HabitsApiClient {
  return {
    createHabit: vi.fn(),
    getStats: vi.fn(),
    getToday: vi.fn(),
    listHabits: vi.fn(),
    removeEntry: vi.fn(),
    removeHabit: vi.fn(),
    updateHabit: vi.fn(),
    upsertEntry: vi.fn(),
    ...overrides,
  }
}

function createEntryInput(
  input: Partial<HabitEntryUpsertInput>,
): HabitEntryUpsertInput {
  return {
    date: '2026-05-11',
    note: '',
    status: 'done',
    ...input,
  }
}

function createHabitRecord(habitId: string): HabitRecord {
  return {
    color: '#2f6f62',
    createdAt: '2026-05-11T00:00:00.000Z',
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    deletedAt: null,
    description: '',
    endDate: null,
    frequency: 'daily',
    icon: 'check',
    id: habitId,
    isActive: true,
    reminderTime: null,
    sortOrder: 0,
    sphereId: null,
    startDate: '2026-05-11',
    targetType: 'check',
    targetValue: 1,
    title: 'Offline habit',
    unit: '',
    updatedAt: '2026-05-11T00:00:00.000Z',
    userId: ACTOR_USER_ID,
    version: 1,
    workspaceId: WORKSPACE_ID,
  }
}
