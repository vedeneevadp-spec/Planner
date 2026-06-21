import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'

import type { Task } from '@planner/contracts'

import { AiContextService } from './ai-context.service.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999'
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'

void describe('AiContextService', () => {
  void it('getTodayContext returns only records for the authenticated user', async () => {
    const service = createService([
      createTask({
        authorUserId: USER_ID,
        dueDate: '2026-06-20',
        importance: 'important',
        title: 'Pay invoice',
      }),
      createTask({
        authorUserId: USER_ID,
        plannedDate: '2026-06-21',
        title: 'Write plan',
      }),
      createTask({
        authorUserId: OTHER_USER_ID,
        plannedDate: '2026-06-21',
        title: 'Other user task',
      }),
    ])

    const context = await service.getTodayContext({
      date: '2026-06-21',
      include: ['tasks', 'stats'],
      userId: USER_ID,
    })

    assert.equal(context.tasks?.totalCount, 2)
    assert.equal(context.tasks?.overdueCount, 1)
    assert.deepEqual(
      context.tasks?.today.map((task) => task.title),
      ['Write plan'],
    )
    assert.equal(
      context.tasks?.today.some((task) => task.title === 'Other user task'),
      false,
    )
    assert.equal(context.stats?.overdueItems, 1)
  })

  void it('getTodayContext works with empty data', async () => {
    const service = createService([])

    const context = await service.getTodayContext({
      date: '2026-06-21',
      include: ['tasks', 'calendar', 'shopping', 'stats'],
      userId: USER_ID,
    })

    assert.equal(context.tasks?.totalCount, 0)
    assert.equal(context.calendar?.totalCount, 0)
    assert.equal(context.shopping?.totalCount, 0)
    assert.equal(context.stats?.loadLevel, 'low')
  })
})

function createService(tasks: Task[]): AiContextService {
  return new AiContextService({
    sessionService: {
      resolveSession: () =>
        Promise.resolve({
          actor: {
            email: 'owner@example.test',
          },
          actorUserId: USER_ID,
          groupRole: null,
          role: 'owner',
          workspace: {
            kind: 'personal',
            name: 'Personal',
          },
          workspaceId: WORKSPACE_ID,
          workspaces: [
            {
              id: WORKSPACE_ID,
              kind: 'personal',
              name: 'Personal',
            },
          ],
        }),
    },
    taskService: {
      listTasks: () => Promise.resolve(tasks),
    },
  })
}

function createTask(overrides: Partial<Task>): Task {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: 'Owner',
    authorUserId: USER_ID,
    completedAt: null,
    createdAt: '2026-06-19T10:00:00.000Z',
    dueDate: null,
    icon: '',
    id: randomUUID(),
    importance: 'not_important',
    linkedTask: null,
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    recurrence: null,
    remindBeforeStart: false,
    reminderOffsets: [],
    requiresConfirmation: false,
    resource: 2,
    routine: null,
    sourceWorkspace: null,
    sphereId: null,
    status: 'todo',
    title: 'Task',
    urgency: 'not_urgent',
    ...overrides,
  }
}
