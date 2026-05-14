import assert from 'node:assert/strict'
import test from 'node:test'

import type { HabitEntryRecord, HabitRecord } from '@planner/contracts'

import { buildHabitStats } from './habit.shared.js'

const BASE_HABIT: HabitRecord = {
  color: '#214e42',
  createdAt: '2026-05-01T00:00:00.000Z',
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
  startDate: '2026-05-05',
  targetType: 'check',
  targetValue: 1,
  title: 'Daily rhythm',
  unit: '',
  updatedAt: '2026-05-01T00:00:00.000Z',
  userId: 'user-1',
  version: 1,
  workspaceId: 'workspace-1',
}

void test('buildHabitStats keeps skipped days neutral for streaks', () => {
  const stats = buildHabitStats(
    BASE_HABIT,
    [
      entry('entry-1', '2026-05-05', 'done'),
      entry('entry-2', '2026-05-06', 'skipped'),
      entry('entry-3', '2026-05-07', 'done'),
    ],
    {
      from: '2026-05-05',
      to: '2026-05-07',
    },
  )

  assert.equal(stats.currentStreak, 2)
  assert.equal(stats.bestStreak, 2)
  assert.equal(stats.completedCount, 2)
  assert.equal(stats.skippedCount, 1)
})

void test('buildHabitStats does not break streak before today is missed', () => {
  const stats = buildHabitStats(
    BASE_HABIT,
    [
      entry('entry-1', '2026-05-05', 'done'),
      entry('entry-2', '2026-05-06', 'done'),
    ],
    {
      from: '2026-05-05',
      to: '2026-05-07',
    },
  )

  assert.equal(stats.currentStreak, 2)
  assert.equal(stats.missedCount, 0)
})

void test('buildHabitStats does not count partial progress as completed', () => {
  const countHabit: HabitRecord = {
    ...BASE_HABIT,
    targetType: 'count',
    targetValue: 3,
    unit: 'стакана',
  }
  const stats = buildHabitStats(
    countHabit,
    [
      entry('entry-1', '2026-05-05', 'done', 2),
      entry('entry-2', '2026-05-06', 'done', 3),
    ],
    {
      from: '2026-05-05',
      to: '2026-05-07',
    },
  )

  assert.equal(stats.completedCount, 1)
  assert.equal(stats.currentStreak, 1)
  assert.equal(stats.weekCompleted, 1)
  assert.equal(stats.monthCompleted, 1)
  assert.equal(stats.missedCount, 1)
})

function entry(
  id: string,
  date: string,
  status: HabitEntryRecord['status'],
  value = status === 'done' ? 1 : 0,
): HabitEntryRecord {
  return {
    createdAt: '2026-05-01T00:00:00.000Z',
    date,
    deletedAt: null,
    habitId: BASE_HABIT.id,
    id,
    note: '',
    status,
    updatedAt: '2026-05-01T00:00:00.000Z',
    userId: BASE_HABIT.userId,
    value,
    version: 1,
    workspaceId: BASE_HABIT.workspaceId,
  }
}
