import assert from 'node:assert/strict'
import test from 'node:test'

import { applyTaskSchedule } from './task.shared.js'

void test('applyTaskSchedule clears reminder flag when planned start is removed', () => {
  const updatedTask = applyTaskSchedule(
    {
      assigneeDisplayName: null,
      assigneeUserId: null,
      authorDisplayName: 'Darya',
      authorUserId: 'user-1',
      completedAt: null,
      createdAt: '2026-05-05T08:00:00.000Z',
      deletedAt: null,
      dueDate: null,
      icon: '',
      id: 'task-1',
      importance: 'not_important',
      note: '',
      plannedDate: '2026-05-05',
      plannedEndTime: '10:00',
      plannedStartTime: '09:00',
      project: '',
      projectId: null,
      remindBeforeStart: true,
      resource: 0,
      requiresConfirmation: false,
      sphereId: null,
      status: 'todo',
      title: 'Reminder task',
      urgency: 'not_urgent',
      updatedAt: '2026-05-05T08:00:00.000Z',
      version: 1,
      workspaceId: 'workspace-1',
    },
    {
      plannedDate: null,
      plannedEndTime: null,
      plannedStartTime: null,
    },
  )

  assert.equal(updatedTask.remindBeforeStart, undefined)
  assert.equal(updatedTask.plannedDate, null)
  assert.equal(updatedTask.plannedStartTime, null)
})
