import assert from 'node:assert/strict'
import test from 'node:test'

import { newHabitInputSchema } from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import { MemoryHabitRepository } from './habit.repository.memory.js'
import { HabitService } from './habit.service.js'

const OWNER_CONTEXT = {
  actorUserId: 'user-1',
  auth: null,
  groupRole: null,
  role: 'owner' as const,
  workspaceId: 'workspace-1',
  workspaceKind: 'personal' as const,
}

const GUEST_CONTEXT = {
  ...OWNER_CONTEXT,
  role: 'guest' as const,
}

void test('HabitService rejects guest writes', async () => {
  const service = new HabitService(new MemoryHabitRepository())

  await assert.rejects(
    Promise.resolve().then(() =>
      service.createHabit(
        GUEST_CONTEXT,
        newHabitInputSchema.parse({
          title: 'Read only habit',
        }),
      ),
    ),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'workspace_write_forbidden',
  )
})

void test('HabitService rejects entries outside the habit schedule', async () => {
  const service = new HabitService(new MemoryHabitRepository())
  const habit = await service.createHabit(
    OWNER_CONTEXT,
    newHabitInputSchema.parse({
      daysOfWeek: [1],
      frequency: 'custom',
      startDate: '2026-05-11',
      title: 'Monday habit',
    }),
  )

  await assert.rejects(
    Promise.resolve().then(() =>
      service.upsertEntry(OWNER_CONTEXT, habit.id, '2026-05-12', {
        date: '2026-05-12',
        note: '',
        status: 'done',
        value: 1,
      }),
    ),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'habit_not_scheduled',
  )
})
