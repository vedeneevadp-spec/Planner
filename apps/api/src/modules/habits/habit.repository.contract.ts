import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  generateUuidV7,
  habitEntryUpsertInputSchema,
  habitUpdateInputSchema,
  newHabitInputSchema,
} from '@planner/contracts'

import { hasHttpErrorCode } from '../../testing/repository-contract-assertions.js'
import type { HabitWriteContext } from './habit.model.js'
import type { HabitRepository } from './habit.repository.js'

export interface HabitRepositoryContractHarness {
  cleanup: () => Promise<void>
  context: HabitWriteContext
  otherContext: HabitWriteContext
  repository: HabitRepository
}

export function defineHabitRepositoryContractSuite(input: {
  createHarness: () => Promise<HabitRepositoryContractHarness>
  name: string
}): void {
  void describe(input.name, () => {
    void test('keeps habit create, list, update, conflict, and workspace isolation consistent', async () => {
      const harness = await input.createHarness()

      try {
        const habitId = generateUuidV7()
        const habit = await harness.repository.create({
          context: harness.context,
          input: newHabitInputSchema.parse({
            color: '  #123456  ',
            daysOfWeek: [3, 1, 3],
            description: '  Drink water  ',
            frequency: 'custom',
            icon: '  drop  ',
            id: habitId,
            reminderTime: '09:30',
            startDate: '2026-05-18',
            targetType: 'count',
            targetValue: 2,
            title: '  Hydrate  ',
            unit: 'cups',
          }),
        })
        const duplicate = await harness.repository.create({
          context: harness.context,
          input: newHabitInputSchema.parse({
            id: habitId,
            title: 'Duplicate should not overwrite',
          }),
        })
        const otherWorkspaceHabit = await harness.repository.create({
          context: harness.otherContext,
          input: newHabitInputSchema.parse({
            title: 'Other workspace habit',
          }),
        })

        assert.equal(duplicate.id, habit.id)
        assert.equal(duplicate.title, 'Hydrate')
        assert.equal(habit.color, '#123456')
        assert.deepEqual(habit.daysOfWeek, [1, 3])
        assert.equal(habit.description, 'Drink water')
        assert.equal(habit.icon, 'drop')
        assert.equal(habit.reminderTime, '09:30')
        assert.equal(habit.sortOrder, 0)
        assert.equal(habit.targetType, 'count')
        assert.equal(habit.targetValue, 2)
        assert.equal(habit.title, 'Hydrate')
        assert.equal(habit.unit, 'cups')
        assert.equal(habit.version, 1)
        assert.equal(habit.workspaceId, harness.context.workspaceId)

        assert.deepEqual(
          (await harness.repository.listByWorkspace(harness.context)).map(
            (candidate) => candidate.id,
          ),
          [habit.id],
        )
        assert.deepEqual(
          (await harness.repository.listByWorkspace(harness.otherContext)).map(
            (candidate) => candidate.id,
          ),
          [otherWorkspaceHabit.id],
        )

        const updated = await harness.repository.update({
          context: harness.context,
          habitId: habit.id,
          input: habitUpdateInputSchema.parse({
            daysOfWeek: [7, 2, 2],
            description: '  Updated  ',
            expectedVersion: habit.version,
            targetValue: 3,
            title: '  Better hydrate  ',
          }),
        })

        assert.deepEqual(updated.daysOfWeek, [2, 7])
        assert.equal(updated.description, 'Updated')
        assert.equal(updated.targetValue, 3)
        assert.equal(updated.title, 'Better hydrate')
        assert.equal(updated.version, habit.version + 1)

        await assert.rejects(
          async () => {
            await harness.repository.update({
              context: harness.context,
              habitId: habit.id,
              input: habitUpdateInputSchema.parse({
                expectedVersion: habit.version,
                title: 'Stale habit update',
              }),
            })
          },
          (error: unknown) => hasHttpErrorCode(error, 'habit_version_conflict'),
        )
      } finally {
        await harness.cleanup()
      }
    })

    void test('keeps habit entry today, stats, delete, and conflict behavior consistent', async () => {
      const harness = await input.createHarness()

      try {
        const habit = await harness.repository.create({
          context: harness.context,
          input: newHabitInputSchema.parse({
            frequency: 'daily',
            startDate: '2026-05-20',
            targetType: 'count',
            targetValue: 2,
            title: 'Read',
            unit: 'pages',
          }),
        })
        const entry = await harness.repository.upsertEntry({
          context: harness.context,
          date: '2026-05-23',
          habitId: habit.id,
          input: habitEntryUpsertInputSchema.parse({
            date: '2026-05-23',
            note: '  morning  ',
            status: 'done',
            value: 2,
          }),
        })

        assert.equal(entry.date, '2026-05-23')
        assert.equal(entry.habitId, habit.id)
        assert.equal(entry.note, 'morning')
        assert.equal(entry.status, 'done')
        assert.equal(entry.targetValue, 2)
        assert.equal(entry.value, 2)
        assert.equal(entry.version, 1)

        const updatedEntry = await harness.repository.upsertEntry({
          context: harness.context,
          date: '2026-05-23',
          habitId: habit.id,
          input: habitEntryUpsertInputSchema.parse({
            date: '2026-05-23',
            expectedVersion: entry.version,
            note: 'evening',
            status: 'done',
            value: 3,
          }),
        })

        assert.equal(updatedEntry.note, 'evening')
        assert.equal(updatedEntry.value, 3)
        assert.equal(updatedEntry.version, entry.version + 1)

        await assert.rejects(
          async () => {
            await harness.repository.upsertEntry({
              context: harness.context,
              date: '2026-05-23',
              habitId: habit.id,
              input: habitEntryUpsertInputSchema.parse({
                date: '2026-05-23',
                expectedVersion: entry.version,
                value: 4,
              }),
            })
          },
          (error: unknown) =>
            hasHttpErrorCode(error, 'habit_entry_version_conflict'),
        )

        const today = await harness.repository.getToday({
          context: harness.context,
          date: '2026-05-23',
        })

        assert.equal(today.date, '2026-05-23')
        assert.equal(today.items.length, 1)
        assert.equal(today.items[0]?.habit.id, habit.id)
        assert.equal(today.items[0]?.entry?.id, entry.id)
        assert.equal(today.items[0]?.progressPercent, 100)

        const stats = await harness.repository.getStats({
          context: harness.context,
          from: '2026-05-20',
          to: '2026-05-23',
        })

        assert.equal(stats.habits.length, 1)
        assert.equal(stats.stats[0]?.habitId, habit.id)
        assert.equal(stats.stats[0]?.completedCount, 1)

        await harness.repository.removeEntry({
          context: harness.context,
          date: '2026-05-23',
          expectedVersion: updatedEntry.version,
          habitId: habit.id,
        })
        assert.equal(
          (
            await harness.repository.getToday({
              context: harness.context,
              date: '2026-05-23',
            })
          ).items[0]?.entry,
          null,
        )

        await harness.repository.remove({
          context: harness.context,
          habitId: habit.id,
        })
        assert.deepEqual(
          await harness.repository.listByWorkspace(harness.context),
          [],
        )
      } finally {
        await harness.cleanup()
      }
    })
  })
}
