import { describe, expect, it } from 'vitest'

import type { Task } from '@/entities/task'

import {
  analyzeDailyLoad,
  getUnloadCandidates,
  groupDailyTasks,
} from './resource-plan'

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    completedAt: null,
    createdAt: '2026-04-22T08:00:00.000Z',
    dueDate: null,
    icon: '',
    id: overrides.id ?? crypto.randomUUID(),
    importance: 'not_important',
    note: '',
    plannedDate: '2026-04-22',
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    resource: -2,
    sphereId: null,
    status: 'todo',
    title: 'Task',
    urgency: 'not_urgent',
    ...overrides,
  }
}

describe('resource plan', () => {
  it('marks minimum mode as overloaded when resource exceeds the limit', () => {
    const analysis = analyzeDailyLoad(
      [createTask(), createTask(), createTask()],
      'minimum',
    )

    expect(analysis.totalResource).toBe(6)
    expect(analysis.state).toBe('overload')
  })

  it('separates focus, support and routine tasks', () => {
    const groups = groupDailyTasks([
      createTask({ importance: 'important', title: 'Ответить клиенту' }),
      createTask({ title: 'купить продукты' }),
      createTask({ project: 'Быт', title: 'счетчики' }),
      createTask({ title: 'Разобрать почту', urgency: 'urgent' }),
    ])

    expect(groups.focusTasks).toHaveLength(1)
    expect(groups.supportTasks).toHaveLength(1)
    expect(groups.routineTasks).toHaveLength(2)
  })

  it('suggests non-important heavy tasks for unloading first', () => {
    const support = createTask({
      id: 'support',
      plannedEndTime: '15:00',
      plannedStartTime: '09:00',
      resource: -5,
    })
    const focus = createTask({ id: 'focus', importance: 'important' })

    expect(getUnloadCandidates([focus, support], 1)[0]?.id).toBe('support')
  })
})
