import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, test } from 'node:test'

import type { NewTaskInput, TaskUpdateInput } from '@planner/contracts'

import type { StoredTaskRecord, TaskWriteContext } from './task.model.js'
import type { TaskRepository } from './task.repository.js'

export interface TaskRepositoryContractHarness {
  cleanup: () => Promise<void>
  personalContext: TaskWriteContext
  personalWorkspace: {
    id: string
    name: string
  }
  projectId: string
  repository: TaskRepository
  sharedContext: TaskWriteContext
  transferPersonalContext: TaskWriteContext
}

export function defineTaskRepositoryContractSuite(input: {
  createHarness: () => Promise<TaskRepositoryContractHarness>
  name: string
}): void {
  void describe(input.name, () => {
    void test('keeps task create, list, filters, pagination, and event cursor consistent', async () => {
      const harness = await input.createHarness()

      try {
        const legacyTask = await harness.repository.create({
          context: harness.personalContext,
          input: createTaskInput({
            icon: '  spark  ',
            id: randomUUID(),
            importance: 'important',
            note: '  contract note  ',
            plannedDate: '2026-05-23',
            plannedEndTime: '10:00',
            plannedStartTime: '09:00',
            project: '  Legacy Filter  ',
            requiresConfirmation: true,
            title: '  Legacy task  ',
            urgency: 'urgent',
          }),
        })
        const secondLegacyTask = await harness.repository.create({
          context: harness.personalContext,
          input: createTaskInput({
            id: randomUUID(),
            plannedDate: '2026-05-24',
            project: 'Legacy Filter',
            title: 'Second legacy task',
          }),
        })
        const projectTask = await harness.repository.create({
          context: harness.personalContext,
          input: createTaskInput({
            id: randomUUID(),
            plannedDate: '2026-05-25',
            projectId: harness.projectId,
            title: 'Project task',
          }),
        })
        const duplicateLegacyTask = await harness.repository.create({
          context: harness.personalContext,
          input: createTaskInput({
            id: legacyTask.id,
            title: 'Duplicate should not overwrite',
          }),
        })

        assert.equal(duplicateLegacyTask.id, legacyTask.id)
        assert.equal(duplicateLegacyTask.title, 'Legacy task')
        assert.equal(legacyTask.icon, 'spark')
        assert.equal(legacyTask.importance, 'important')
        assert.equal(legacyTask.note, 'contract note')
        assert.equal(legacyTask.plannedEndTime, '10:00')
        assert.equal(legacyTask.plannedStartTime, '09:00')
        assert.equal(legacyTask.project, 'Legacy Filter')
        assert.equal(legacyTask.requiresConfirmation, true)
        assert.equal(legacyTask.status, 'todo')
        assert.equal(legacyTask.title, 'Legacy task')
        assert.equal(legacyTask.urgency, 'urgent')
        assert.equal(legacyTask.version, 1)
        assert.equal(
          legacyTask.workspaceId,
          harness.personalContext.workspaceId,
        )

        const doneTask = await harness.repository.updateStatus({
          context: harness.personalContext,
          expectedVersion: projectTask.version,
          status: 'done',
          taskId: projectTask.id,
        })

        assert.equal(doneTask.status, 'done')

        await assertTaskIds(
          harness.repository.listByWorkspace(harness.personalContext),
          [legacyTask.id, secondLegacyTask.id, projectTask.id],
        )
        await assertTaskIds(
          harness.repository.listByWorkspace(harness.personalContext, {
            plannedDate: '2026-05-23',
          }),
          [legacyTask.id],
        )
        await assertTaskIds(
          harness.repository.listByWorkspace(harness.personalContext, {
            project: 'Legacy Filter',
          }),
          [legacyTask.id, secondLegacyTask.id],
        )
        await assertTaskIds(
          harness.repository.listByWorkspace(harness.personalContext, {
            projectId: harness.projectId,
          }),
          [projectTask.id],
        )
        await assertTaskIds(
          harness.repository.listByWorkspace(harness.personalContext, {
            status: 'done',
          }),
          [projectTask.id],
        )

        const firstPage = await harness.repository.listPageByWorkspace(
          harness.personalContext,
          {
            limit: 1,
            offset: 0,
            project: 'Legacy Filter',
          },
        )
        const secondPage = await harness.repository.listPageByWorkspace(
          harness.personalContext,
          {
            limit: 1,
            offset: 1,
            project: 'Legacy Filter',
          },
        )

        assert.equal(firstPage.hasMore, true)
        assert.equal(firstPage.nextOffset, 1)
        assert.equal(secondPage.hasMore, false)
        assert.equal(secondPage.nextOffset, null)
        assert.deepEqual(
          [...firstPage.items, ...secondPage.items]
            .map((task) => task.id)
            .sort(),
          [legacyTask.id, secondLegacyTask.id].sort(),
        )

        const foundTask = await harness.repository.findById(
          harness.personalContext,
          legacyTask.id,
        )
        const missingFromSharedWorkspace = await harness.repository.findById(
          harness.sharedContext,
          legacyTask.id,
        )

        assert.equal(foundTask?.id, legacyTask.id)
        assert.equal(missingFromSharedWorkspace, null)

        const events = await harness.repository.listEventsByWorkspace(
          harness.personalContext,
          {
            limit: 10,
          },
        )

        assert.deepEqual(
          events.events.map((event) => event.eventType),
          [
            'task.created',
            'task.created',
            'task.created',
            'task.status_changed',
          ],
        )
        assert.equal(events.nextEventId, events.events.at(-1)?.id)

        const laterEvents = await harness.repository.listEventsByWorkspace(
          harness.personalContext,
          {
            afterEventId: events.events[1]?.id ?? 0,
            limit: 10,
          },
        )

        assert.deepEqual(
          laterEvents.events.map((event) => event.eventType),
          ['task.created', 'task.status_changed'],
        )
      } finally {
        await harness.cleanup()
      }
    })

    void test('keeps task update, schedule, delete, and conflict behavior consistent', async () => {
      const harness = await input.createHarness()

      try {
        const task = await harness.repository.create({
          context: harness.personalContext,
          input: createTaskInput({
            plannedDate: '2026-05-23',
            plannedStartTime: '09:00',
            remindBeforeStart: true,
            reminderTimeZone: 'Asia/Novosibirsk',
            title: 'Task to update',
          }),
        })
        const updatedTask = await harness.repository.update({
          context: harness.personalContext,
          expectedVersion: task.version,
          input: createTaskUpdateInput({
            dueDate: '2026-05-30',
            note: '  updated note  ',
            plannedDate: '2026-05-24',
            plannedEndTime: '11:00',
            plannedStartTime: '10:00',
            resource: 3,
            title: '  Updated task  ',
          }),
          taskId: task.id,
        })

        assert.equal(updatedTask.dueDate, '2026-05-30')
        assert.equal(updatedTask.note, 'updated note')
        assert.equal(updatedTask.plannedDate, '2026-05-24')
        assert.equal(updatedTask.plannedEndTime, '11:00')
        assert.equal(updatedTask.plannedStartTime, '10:00')
        assert.equal(updatedTask.resource, 3)
        assert.equal(updatedTask.title, 'Updated task')
        assert.equal(updatedTask.version, task.version + 1)

        await assert.rejects(
          async () => {
            await harness.repository.update({
              context: harness.personalContext,
              expectedVersion: task.version,
              input: createTaskUpdateInput({ title: 'Stale update' }),
              taskId: task.id,
            })
          },
          (error: unknown) => hasHttpErrorCode(error, 'task_version_conflict'),
        )

        const rescheduledTask = await harness.repository.updateSchedule({
          context: harness.personalContext,
          expectedVersion: updatedTask.version,
          schedule: {
            plannedDate: null,
            plannedEndTime: null,
            plannedStartTime: null,
          },
          taskId: task.id,
        })

        assert.equal(rescheduledTask.plannedDate, null)
        assert.equal(rescheduledTask.plannedEndTime, null)
        assert.equal(rescheduledTask.plannedStartTime, null)
        assert.equal(rescheduledTask.remindBeforeStart, undefined)

        await harness.repository.remove({
          context: harness.personalContext,
          expectedVersion: rescheduledTask.version,
          taskId: task.id,
        })

        assert.equal(
          await harness.repository.findById(harness.personalContext, task.id),
          null,
        )
        await assert.rejects(
          async () => {
            await harness.repository.remove({
              context: harness.personalContext,
              taskId: task.id,
            })
          },
          (error: unknown) => hasHttpErrorCode(error, 'task_not_found'),
        )

        const events = await harness.repository.listEventsByWorkspace(
          harness.personalContext,
        )

        assert.deepEqual(
          events.events.map((event) => event.eventType),
          ['task.created', 'task.updated', 'task.updated', 'task.deleted'],
        )
      } finally {
        await harness.cleanup()
      }
    })

    void test('keeps fixed-zone task end times stable after reload', async () => {
      const harness = await input.createHarness()
      const context: TaskWriteContext = {
        ...harness.personalContext,
        clientTimeZone: 'Europe/Astrakhan',
      }

      try {
        const task = await harness.repository.create({
          context,
          input: createTaskInput({
            plannedDate: '2099-06-25',
            plannedEndTime: '19:15',
            plannedStartTime: '18:00',
            title: 'Fixed zone time task',
          }),
        })

        assert.equal(task.plannedStartTime, '18:00')
        assert.equal(task.plannedEndTime, '19:15')

        const foundTask = await harness.repository.findById(context, task.id)
        const listedTasks = await harness.repository.listByWorkspace(context, {
          plannedDate: '2099-06-25',
        })

        assert.equal(foundTask?.plannedStartTime, '18:00')
        assert.equal(foundTask?.plannedEndTime, '19:15')
        assert.equal(listedTasks[0]?.id, task.id)
        assert.equal(listedTasks[0]?.plannedStartTime, '18:00')
        assert.equal(listedTasks[0]?.plannedEndTime, '19:15')
      } finally {
        await harness.cleanup()
      }
    })

    void test('keeps shared to personal task transfer semantics consistent', async () => {
      const harness = await input.createHarness()

      try {
        const sharedTask = await harness.repository.create({
          context: harness.sharedContext,
          input: createTaskInput({
            plannedDate: '2026-05-23',
            plannedStartTime: '09:00',
            project: 'Shared project',
            requiresConfirmation: true,
            title: 'Shared task',
          }),
        })
        const personalCopy = await harness.repository.copyToPersonal({
          context: harness.sharedContext,
          expectedVersion: sharedTask.version,
          targetWorkspace: harness.personalWorkspace,
          task: sharedTask,
        })

        assert.equal(personalCopy.workspaceId, harness.personalWorkspace.id)
        assert.deepEqual(personalCopy.linkedTask, {
          id: sharedTask.id,
          workspaceId: harness.sharedContext.workspaceId,
        })
        assert.deepEqual(personalCopy.sourceWorkspace, {
          id: harness.sharedContext.workspaceId,
          name: harness.sharedContext.workspaceName,
        })
        assert.equal(personalCopy.project, '')
        assert.equal(personalCopy.projectId, null)
        assert.equal(personalCopy.requiresConfirmation, false)

        await harness.repository.updateStatus({
          context: harness.transferPersonalContext,
          expectedVersion: personalCopy.version,
          status: 'done',
          taskId: personalCopy.id,
        })

        const syncedSharedTask = await harness.repository.findById(
          harness.sharedContext,
          sharedTask.id,
        )

        assert.equal(syncedSharedTask?.status, 'done')

        const taskToMove = await harness.repository.create({
          context: harness.sharedContext,
          input: createTaskInput({
            title: 'Move me',
          }),
        })
        const movedTask = await harness.repository.moveToPersonal({
          context: harness.sharedContext,
          expectedVersion: taskToMove.version,
          targetWorkspace: harness.personalWorkspace,
          task: taskToMove,
        })

        assert.equal(movedTask.workspaceId, harness.personalWorkspace.id)
        assert.equal(movedTask.linkedTask, null)
        assert.equal(movedTask.sourceWorkspace, null)
        assert.equal(
          await harness.repository.findById(
            harness.sharedContext,
            taskToMove.id,
          ),
          null,
        )
        assert.equal(
          (
            await harness.repository.findById(
              harness.transferPersonalContext,
              movedTask.id,
            )
          )?.id,
          movedTask.id,
        )
      } finally {
        await harness.cleanup()
      }
    })
  })
}

export function createTaskInput(
  overrides: Partial<NewTaskInput> = {},
): NewTaskInput {
  return {
    assigneeUserId: null,
    dueDate: null,
    icon: '',
    importance: 'not_important',
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    recurrence: null,
    remindBeforeStart: false,
    resource: null,
    requiresConfirmation: false,
    routine: null,
    sphereId: null,
    title: 'Contract task',
    urgency: 'not_urgent',
    ...overrides,
  }
}

function createTaskUpdateInput(
  overrides: Partial<TaskUpdateInput> = {},
): TaskUpdateInput {
  const { id: _id, ...input } = createTaskInput()

  return {
    ...input,
    ...overrides,
  }
}

async function assertTaskIds(
  actual: Promise<StoredTaskRecord[]>,
  expectedIds: string[],
): Promise<void> {
  assert.deepEqual(
    (await actual).map((task) => task.id).sort(),
    [...expectedIds].sort(),
  )
}

function hasHttpErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  )
}
