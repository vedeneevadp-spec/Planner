import assert from 'node:assert/strict'
import test from 'node:test'

import { HttpError } from '../../bootstrap/http-error.js'
import { MemoryTaskRepository } from './task.repository.memory.js'
import { TaskService } from './task.service.js'

const PERSONAL_CONTEXT = {
  actorDisplayName: 'Darya',
  actorUserId: 'user-1',
  auth: null,
  groupRole: null,
  role: 'owner' as const,
  workspaceId: 'workspace-1',
  workspaceKind: 'personal' as const,
}

const SHARED_CONTEXT = {
  ...PERSONAL_CONTEXT,
  workspaceKind: 'shared' as const,
}

const BASE_INPUT = {
  assigneeUserId: null,
  dueDate: null,
  icon: '',
  note: '',
  plannedDate: '2026-05-05',
  plannedEndTime: null,
  plannedStartTime: '09:00',
  project: '',
  projectId: null,
  resource: 0,
  requiresConfirmation: false,
  sphereId: null,
  title: 'Task reminder test',
}

void test('TaskService allows a personal task reminder when start time is set', async () => {
  const service = new TaskService(new MemoryTaskRepository())

  const task = await service.createTask(PERSONAL_CONTEXT, {
    ...BASE_INPUT,
    remindBeforeStart: true,
    reminderTimeZone: 'Asia/Novosibirsk',
  })

  assert.equal(task.remindBeforeStart, true)
})

void test('TaskService rejects task reminders in shared workspaces', async () => {
  const service = new TaskService(new MemoryTaskRepository())

  await assert.rejects(
    Promise.resolve().then(() =>
      service.createTask(SHARED_CONTEXT, {
        ...BASE_INPUT,
        remindBeforeStart: true,
      }),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'task_reminder_personal_workspace_required',
  )
})

void test('TaskService requires a start time for task reminders', async () => {
  const service = new TaskService(new MemoryTaskRepository())

  await assert.rejects(
    Promise.resolve().then(() =>
      service.createTask(PERSONAL_CONTEXT, {
        ...BASE_INPUT,
        plannedStartTime: null,
        remindBeforeStart: true,
      }),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'task_reminder_start_time_required',
  )
})
