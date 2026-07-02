import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  cleaningTaskActionInputSchema,
  cleaningTaskUpdateInputSchema,
  cleaningZoneUpdateInputSchema,
  generateUuidV7,
  newCleaningTaskInputSchema,
  newCleaningZoneInputSchema,
} from '@planner/contracts'

import type { CleaningWriteContext } from './cleaning.model.js'
import type { CleaningRepository } from './cleaning.repository.js'

export interface CleaningRepositoryContractHarness {
  cleanup: () => Promise<void>
  context: CleaningWriteContext
  repository: CleaningRepository
}

export function defineCleaningRepositoryContractSuite(input: {
  createHarness: () => Promise<CleaningRepositoryContractHarness>
  name: string
}): void {
  void describe(input.name, () => {
    void test('keeps cleaning zone and task lifecycle consistent', async () => {
      const harness = await input.createHarness()

      try {
        const kitchenZone = await harness.repository.createZone({
          context: harness.context,
          input: newCleaningZoneInputSchema.parse({
            dayOfWeek: 1,
            description: '  Main room  ',
            id: generateUuidV7(),
            title: '  Kitchen  ',
          }),
        })
        const duplicateKitchenZone = await harness.repository.createZone({
          context: harness.context,
          input: newCleaningZoneInputSchema.parse({
            dayOfWeek: 5,
            id: kitchenZone.id,
            title: 'Duplicate zone',
          }),
        })
        const bathroomZone = await harness.repository.createZone({
          context: harness.context,
          input: newCleaningZoneInputSchema.parse({
            dayOfWeek: 2,
            sortOrder: 0,
            title: 'Bathroom',
          }),
        })

        assert.equal(duplicateKitchenZone.id, kitchenZone.id)
        assert.equal(duplicateKitchenZone.title, 'Kitchen')
        assert.equal(kitchenZone.dayOfWeek, 1)
        assert.equal(kitchenZone.description, 'Main room')
        assert.equal(kitchenZone.isActive, true)
        assert.equal(kitchenZone.sortOrder, 0)
        assert.equal(kitchenZone.version, 1)
        assert.equal(kitchenZone.workspaceId, harness.context.workspaceId)

        const updatedKitchenZone = await harness.repository.updateZone({
          context: harness.context,
          input: cleaningZoneUpdateInputSchema.parse({
            description: '  Food prep  ',
            expectedVersion: kitchenZone.version,
            title: '  Pantry  ',
          }),
          zoneId: kitchenZone.id,
        })

        assert.equal(updatedKitchenZone.description, 'Food prep')
        assert.equal(updatedKitchenZone.title, 'Pantry')
        assert.equal(updatedKitchenZone.version, kitchenZone.version + 1)

        await assert.rejects(
          async () => {
            await harness.repository.updateZone({
              context: harness.context,
              input: cleaningZoneUpdateInputSchema.parse({
                expectedVersion: kitchenZone.version,
                title: 'Stale pantry',
              }),
              zoneId: kitchenZone.id,
            })
          },
          (error: unknown) =>
            hasHttpErrorCode(error, 'cleaning_zone_version_conflict'),
        )

        const task = await harness.repository.createTask({
          context: harness.context,
          input: newCleaningTaskInputSchema.parse({
            customIntervalDays: null,
            estimatedMinutes: 30,
            frequencyInterval: 3,
            frequencyType: 'custom',
            id: generateUuidV7(),
            isSeasonal: true,
            priority: 'high',
            seasonMonths: [12, 1, 12],
            tags: ['  weekly ', 'weekly', 'deep'],
            title: '  Clean fridge  ',
            zoneId: updatedKitchenZone.id,
          }),
        })
        const duplicateTask = await harness.repository.createTask({
          context: harness.context,
          input: newCleaningTaskInputSchema.parse({
            id: task.id,
            title: 'Duplicate task',
            zoneId: updatedKitchenZone.id,
          }),
        })

        assert.equal(duplicateTask.id, task.id)
        assert.equal(duplicateTask.title, 'Clean fridge')
        assert.equal(task.customIntervalDays, 3)
        assert.equal(task.estimatedMinutes, 30)
        assert.equal(task.frequencyInterval, 3)
        assert.equal(task.frequencyType, 'custom')
        assert.equal(task.priority, 'high')
        assert.equal(task.scope, 'zone')
        assert.deepEqual(task.seasonMonths, [1, 12])
        assert.deepEqual(task.tags, ['weekly', 'deep'])
        assert.equal(task.title, 'Clean fridge')
        assert.equal(task.version, 1)

        const updatedTask = await harness.repository.updateTask({
          context: harness.context,
          input: cleaningTaskUpdateInputSchema.parse({
            expectedVersion: task.version,
            frequencyType: 'weekly',
            priority: 'normal',
            title: '  Wipe fridge  ',
            zoneId: bathroomZone.id,
          }),
          taskId: task.id,
        })

        assert.equal(updatedTask.customIntervalDays, null)
        assert.equal(updatedTask.frequencyType, 'weekly')
        assert.equal(updatedTask.priority, 'normal')
        assert.equal(updatedTask.title, 'Wipe fridge')
        assert.equal(updatedTask.version, task.version + 1)
        assert.equal(updatedTask.zoneId, bathroomZone.id)

        await assert.rejects(
          async () => {
            await harness.repository.updateTask({
              context: harness.context,
              input: cleaningTaskUpdateInputSchema.parse({
                expectedVersion: task.version,
                title: 'Stale task',
              }),
              taskId: task.id,
            })
          },
          (error: unknown) =>
            hasHttpErrorCode(error, 'cleaning_task_version_conflict'),
        )

        const list = await harness.repository.listByWorkspace(harness.context)

        assert.deepEqual(
          list.zones.map((zone) => zone.id).sort(),
          [kitchenZone.id, bathroomZone.id].sort(),
        )
        assert.deepEqual(
          list.tasks.map((candidate) => candidate.id),
          [updatedTask.id],
        )

        await harness.repository.removeTask({
          context: harness.context,
          taskId: task.id,
        })
        assert.deepEqual(
          (await harness.repository.listByWorkspace(harness.context)).tasks.map(
            (candidate) => candidate.id,
          ),
          [],
        )

        const taskRemovedWithZone = await harness.repository.createTask({
          context: harness.context,
          input: newCleaningTaskInputSchema.parse({
            title: 'Remove with zone',
            zoneId: bathroomZone.id,
          }),
        })

        await harness.repository.removeZone({
          context: harness.context,
          zoneId: bathroomZone.id,
        })

        const listAfterZoneRemoval = await harness.repository.listByWorkspace(
          harness.context,
        )

        assert.equal(
          listAfterZoneRemoval.zones.some(
            (zone) => zone.id === bathroomZone.id,
          ),
          false,
        )
        assert.equal(
          listAfterZoneRemoval.tasks.some(
            (candidate) => candidate.id === taskRemovedWithZone.id,
          ),
          false,
        )

        await assert.rejects(
          async () => {
            await harness.repository.createTask({
              context: harness.context,
              input: newCleaningTaskInputSchema.parse({
                title: 'Missing zone task',
                zoneId: bathroomZone.id,
              }),
            })
          },
          (error: unknown) =>
            hasHttpErrorCode(error, 'cleaning_zone_not_found'),
        )
      } finally {
        await harness.cleanup()
      }
    })

    void test('supports general cleaning tasks without zones', async () => {
      const harness = await input.createHarness()

      try {
        assert.throws(() => {
          newCleaningTaskInputSchema.parse({
            scope: 'zone',
            title: 'Missing zone',
          })
        })
        assert.throws(() => {
          newCleaningTaskInputSchema.parse({
            scope: 'general',
            title: 'General with zone',
            zoneId: generateUuidV7(),
          })
        })

        const zone = await harness.repository.createZone({
          context: harness.context,
          input: newCleaningZoneInputSchema.parse({
            dayOfWeek: 1,
            title: 'Kitchen',
          }),
        })
        const zoneTask = await harness.repository.createTask({
          context: harness.context,
          input: newCleaningTaskInputSchema.parse({
            title: 'Wipe sink',
            zoneId: zone.id,
          }),
        })
        const generalTask = await harness.repository.createTask({
          context: harness.context,
          input: newCleaningTaskInputSchema.parse({
            estimatedMinutes: 40,
            frequencyInterval: 2,
            priority: 'high',
            scope: 'general',
            title: 'Wash windows',
          }),
        })

        assert.equal(generalTask.scope, 'general')
        assert.equal(generalTask.zoneId, null)

        const list = await harness.repository.listByWorkspace(harness.context)

        assert.equal(
          list.tasks.some((candidate) => candidate.id === generalTask.id),
          true,
        )

        const today = await harness.repository.getToday({
          context: harness.context,
          date: '2026-05-25',
        })

        assert.equal(
          today.items.some((item) => item.task.id === generalTask.id),
          false,
        )
        assert.equal(today.items[0]?.task.id, zoneTask.id)
        assert.equal(today.generalItems[0]?.task.id, generalTask.id)
        assert.equal(today.generalItems[0]?.zone, null)
        assert.equal(today.summary.generalCount, 1)
        assert.equal(today.summary.dueCount, 2)
        assert.equal(
          today.urgentItems.some((item) => item.task.id === generalTask.id),
          true,
        )

        const postponedAction = await harness.repository.recordTaskAction({
          action: 'postponed',
          context: harness.context,
          input: cleaningTaskActionInputSchema.parse({
            date: '2026-05-25',
          }),
          taskId: generalTask.id,
        })

        assert.equal(postponedAction.historyItem.zoneId, null)
        assert.equal(postponedAction.historyItem.targetDate, '2026-05-26')
        assert.equal(postponedAction.state.nextDueAt, '2026-05-26')

        await harness.repository.recordTaskAction({
          action: 'postponed',
          context: harness.context,
          input: cleaningTaskActionInputSchema.parse({
            date: '2026-05-26',
          }),
          taskId: generalTask.id,
        })

        const accumulatedToday = await harness.repository.getToday({
          context: harness.context,
          date: '2026-05-27',
        })

        assert.equal(
          accumulatedToday.accumulatedItems.some(
            (item) => item.task.id === generalTask.id,
          ),
          true,
        )

        const completedAction = await harness.repository.recordTaskAction({
          action: 'completed',
          context: harness.context,
          input: cleaningTaskActionInputSchema.parse({
            date: '2026-05-27',
          }),
          taskId: generalTask.id,
        })

        assert.equal(completedAction.state.nextDueAt, '2026-06-10')
        assert.equal(completedAction.state.postponeCount, 0)

        await harness.repository.removeZone({
          context: harness.context,
          zoneId: zone.id,
        })

        const listAfterZoneRemoval = await harness.repository.listByWorkspace(
          harness.context,
        )

        assert.equal(
          listAfterZoneRemoval.tasks.some(
            (candidate) => candidate.id === generalTask.id,
          ),
          true,
        )
        assert.equal(
          listAfterZoneRemoval.tasks.some(
            (candidate) => candidate.id === zoneTask.id,
          ),
          false,
        )
      } finally {
        await harness.cleanup()
      }
    })

    void test('keeps cleaning task actions, states, history, and today projections consistent', async () => {
      const harness = await input.createHarness()

      try {
        const zone = await harness.repository.createZone({
          context: harness.context,
          input: newCleaningZoneInputSchema.parse({
            dayOfWeek: 1,
            title: 'Kitchen',
          }),
        })
        const task = await harness.repository.createTask({
          context: harness.context,
          input: newCleaningTaskInputSchema.parse({
            energy: 'low',
            estimatedMinutes: 10,
            priority: 'high',
            title: 'Wash floor',
            zoneId: zone.id,
          }),
        })
        const initialToday = await harness.repository.getToday({
          context: harness.context,
          date: '2026-05-25',
        })

        assert.equal(initialToday.summary.dueCount, 1)
        assert.equal(initialToday.quickItems[0]?.task.id, task.id)
        assert.equal(initialToday.urgentItems[0]?.task.id, task.id)

        await harness.repository.recordTaskAction({
          action: 'postponed',
          context: harness.context,
          input: cleaningTaskActionInputSchema.parse({
            date: '2026-05-11',
          }),
          taskId: task.id,
        })
        await harness.repository.recordTaskAction({
          action: 'postponed',
          context: harness.context,
          input: cleaningTaskActionInputSchema.parse({
            date: '2026-05-18',
          }),
          taskId: task.id,
        })

        const postponedToday = await harness.repository.getToday({
          context: harness.context,
          date: '2026-05-25',
        })

        assert.equal(postponedToday.urgentItems[0]?.task.id, task.id)
        assert.equal(postponedToday.urgentItems[0]?.state.postponeCount, 2)

        const completedAction = await harness.repository.recordTaskAction({
          action: 'completed',
          context: harness.context,
          input: cleaningTaskActionInputSchema.parse({
            date: '2026-05-25',
            note: '  done  ',
          }),
          taskId: task.id,
        })

        assert.equal(completedAction.historyItem.action, 'completed')
        assert.equal(completedAction.historyItem.note, 'done')
        assert.equal(completedAction.state.nextDueAt, '2026-06-01')
        assert.equal(completedAction.state.postponeCount, 0)

        const duplicateCompletion = await harness.repository.recordTaskAction({
          action: 'completed',
          context: harness.context,
          input: cleaningTaskActionInputSchema.parse({
            date: '2026-05-25',
          }),
          taskId: task.id,
        })

        assert.equal(
          duplicateCompletion.historyItem.id,
          completedAction.historyItem.id,
        )

        const sameDayAfterCompletion = await harness.repository.getToday({
          context: harness.context,
          date: '2026-05-25',
        })

        assert.equal(
          sameDayAfterCompletion.items.some((item) => item.task.id === task.id),
          false,
        )
        assert.equal(sameDayAfterCompletion.summary.completedTodayCount, 1)

        const listAfterCompletion = await harness.repository.listByWorkspace(
          harness.context,
        )

        assert.equal(
          listAfterCompletion.history.filter(
            (item) =>
              item.taskId === task.id &&
              item.action === 'completed' &&
              item.date === '2026-05-25',
          ).length,
          1,
        )

        const skippedTask = await harness.repository.createTask({
          context: harness.context,
          input: newCleaningTaskInputSchema.parse({
            title: 'Skip me',
            zoneId: zone.id,
          }),
        })
        const skippedAction = await harness.repository.recordTaskAction({
          action: 'skipped',
          context: harness.context,
          input: cleaningTaskActionInputSchema.parse({
            date: '2026-05-25',
          }),
          taskId: skippedTask.id,
        })

        assert.equal(skippedAction.historyItem.action, 'skipped')
        assert.equal(skippedAction.state.nextDueAt, '2026-06-01')
        assert.ok(skippedAction.state.lastSkippedAt)
      } finally {
        await harness.cleanup()
      }
    })
  })
}

function hasHttpErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}
