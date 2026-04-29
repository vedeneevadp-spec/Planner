import { describe, expect, it } from 'vitest'

import type { Project } from '@/entities/project'
import type { Task } from '@/entities/task'

import {
  buildSphereStats,
  getCurrentWeekRange,
  UNSPHERED_ID,
} from './sphere-stats'

const project: Project = {
  color: '#214e42',
  createdAt: '2026-04-01T00:00:00.000Z',
  deletedAt: null,
  description: '',
  icon: 'svg:folder',
  id: 'work',
  status: 'active',
  title: 'Работа',
  updatedAt: '2026-04-01T00:00:00.000Z',
  version: 1,
  workspaceId: 'workspace',
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: '2026-04-20T08:00:00.000Z',
    dueDate: null,
    icon: '',
    id: 'task',
    importance: 'not_important',
    note: '',
    plannedDate: '2026-04-22',
    plannedEndTime: null,
    plannedStartTime: null,
    project: 'Работа',
    projectId: 'work',
    resource: null,
    requiresConfirmation: false,
    sphereId: null,
    status: 'todo',
    title: 'Task',
    urgency: 'not_urgent',
    ...overrides,
  }
}

describe('sphere stats', () => {
  it('builds Monday to Sunday week range', () => {
    expect(getCurrentWeekRange(new Date(2026, 3, 22))).toEqual({
      from: '2026-04-20',
      to: '2026-04-26',
    })
  })

  it('counts weekly planned, completed and overdue tasks', () => {
    const stats = buildSphereStats(
      [project],
      [
        createTask({ plannedDate: '2026-04-22' }),
        createTask({
          completedAt: '2026-04-21T12:00:00.000Z',
          id: 'done',
          plannedDate: '2026-04-21',
          status: 'done',
        }),
        createTask({ id: 'late', plannedDate: '2026-04-20' }),
      ],
      { from: '2026-04-20', to: '2026-04-26' },
      '2026-04-22',
    )[0]

    expect(stats?.plannedCount).toBe(2)
    expect(stats?.completedCount).toBe(1)
    expect(stats?.overdueCount).toBe(1)
  })

  it('creates an unassigned sphere for tasks without project', () => {
    const stats = buildSphereStats(
      [],
      [createTask({ project: '', projectId: null })],
      { from: '2026-04-20', to: '2026-04-26' },
      '2026-04-22',
    )

    expect(stats[0]?.sphereId).toBe(UNSPHERED_ID)
  })
})
