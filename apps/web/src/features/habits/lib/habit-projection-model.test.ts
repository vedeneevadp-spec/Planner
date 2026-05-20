import type { HabitEntryRecord, HabitRecord } from '@planner/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyHabitUpdate,
  createFallbackStatsResponse,
  createFallbackTodayResponse,
  createOptimisticHabitEntry,
  removeEntryInTodayResponse,
  upsertEntryInTodayResponse,
  upsertHabitInTodayResponse,
} from './habit-projection-model'

const BASE_HABIT: HabitRecord = {
  color: '#2f6f62',
  createdAt: '2026-05-10T00:00:00.000Z',
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  deletedAt: null,
  description: '',
  endDate: null,
  frequency: 'daily',
  icon: 'check',
  id: 'habit-1',
  isActive: true,
  reminderTime: null,
  sortOrder: 1,
  sphereId: null,
  startDate: '2026-05-10',
  targetType: 'count',
  targetValue: 5,
  title: 'Read',
  unit: 'pages',
  updatedAt: '2026-05-10T00:00:00.000Z',
  userId: 'user-1',
  version: 2,
  workspaceId: 'workspace-1',
}

const BASE_ENTRY: HabitEntryRecord = {
  createdAt: '2026-05-11T07:00:00.000Z',
  date: '2026-05-11',
  deletedAt: null,
  habitId: BASE_HABIT.id,
  id: 'entry-1',
  note: '',
  status: 'done',
  targetValue: 5,
  updatedAt: '2026-05-11T07:00:00.000Z',
  userId: 'user-1',
  value: 3,
  version: 1,
  workspaceId: 'workspace-1',
}

describe('habit projection model', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds fallback today responses from active scheduled habits', () => {
    const inactiveHabit = {
      ...BASE_HABIT,
      id: 'habit-inactive',
      isActive: false,
      sortOrder: 0,
      title: 'Inactive',
    }
    const laterHabit = {
      ...BASE_HABIT,
      id: 'habit-later',
      sortOrder: 0,
      startDate: '2026-05-12',
      title: 'Later',
    }
    const firstHabit = {
      ...BASE_HABIT,
      id: 'habit-first',
      sortOrder: 0,
      title: 'First',
    }

    const response = createFallbackTodayResponse('2026-05-11', [
      BASE_HABIT,
      inactiveHabit,
      laterHabit,
      firstHabit,
    ])

    expect(response.items.map((item) => item.habit.id)).toEqual([
      'habit-first',
      'habit-1',
    ])
    expect(response.items[0]).toMatchObject({
      entry: null,
      isDueToday: true,
      progressPercent: 0,
      stats: {
        habitId: 'habit-first',
        scheduledCount: 0,
      },
    })
  })

  it('updates today entries and recalculates progress from entry targets', () => {
    const response = createFallbackTodayResponse('2026-05-11', [BASE_HABIT])
    const updatedResponse = upsertEntryInTodayResponse(
      response,
      BASE_HABIT.id,
      {
        ...BASE_ENTRY,
        targetValue: 4,
        value: 3,
      },
    )

    expect(updatedResponse.items[0]).toMatchObject({
      entry: {
        id: 'entry-1',
      },
      progressPercent: 75,
    })

    expect(
      removeEntryInTodayResponse(updatedResponse, BASE_HABIT.id).items[0],
    ).toMatchObject({
      entry: null,
      progressPercent: 0,
    })
  })

  it('removes habits from today responses when schedule changes exclude the date', () => {
    const response = createFallbackTodayResponse('2026-05-11', [BASE_HABIT])
    const updatedResponse = upsertHabitInTodayResponse(response, {
      ...BASE_HABIT,
      daysOfWeek: [2],
    })

    expect(updatedResponse.items).toEqual([])
  })

  it('builds fallback stats responses with sorted habit records', () => {
    const firstHabit = {
      ...BASE_HABIT,
      id: 'habit-first',
      sortOrder: 0,
      title: 'First',
    }

    const response = createFallbackStatsResponse('2026-05-01', '2026-05-31', [
      BASE_HABIT,
      firstHabit,
    ])

    expect(response.habits.map((habit) => habit.id)).toEqual([
      'habit-first',
      'habit-1',
    ])
    expect(response.stats.map((stats) => stats.habitId)).toEqual([
      'habit-first',
      'habit-1',
    ])
  })

  it('creates optimistic entries with default check values', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-11T08:00:00.000Z'))

    const entry = createOptimisticHabitEntry({
      actorUserId: 'user-1',
      date: '2026-05-11',
      habit: {
        ...BASE_HABIT,
        targetType: 'check',
        targetValue: 1,
      },
      input: {
        date: '2026-05-11',
        note: '',
        status: 'done',
      },
      previousEntry: null,
      workspaceId: 'workspace-1',
    })

    expect(entry).toMatchObject({
      createdAt: '2026-05-11T08:00:00.000Z',
      habitId: BASE_HABIT.id,
      id: 'optimistic-habit-entry-habit-1-2026-05-11',
      status: 'done',
      value: 1,
      version: 1,
    })
  })

  it('applies habit updates without leaking expected version into records', () => {
    const habit = applyHabitUpdate(BASE_HABIT, {
      expectedVersion: 2,
      title: 'Updated',
    })

    expect(habit).toMatchObject({
      title: 'Updated',
      version: 3,
    })
    expect(habit).not.toHaveProperty('expectedVersion')
  })
})
