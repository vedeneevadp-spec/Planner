import { describe, expect, it } from 'vitest'

import type { Task } from '@/entities/task'
import {
  addTask,
  getPlannerSummary,
  groupTasksByProject,
  setTaskPlannedDate,
  setTaskStatus,
} from '@/entities/task'

const baseTask: Task = {
  id: 'task-1',
  title: 'Write docs',
  note: 'Architecture outline',
  project: 'Planner',
  status: 'todo',
  plannedDate: '2026-04-15',
  dueDate: null,
  createdAt: '2026-04-14T09:00:00.000Z',
  completedAt: null,
}

describe('planner model', () => {
  it('adds a normalized task and keeps the list sorted', () => {
    const tasks = addTask(
      [baseTask],
      {
        title: '  Review CI  ',
        note: '  tighten checks  ',
        project: '  Ops  ',
        plannedDate: '2026-04-14',
        dueDate: null,
      },
      {
        now: '2026-04-13T09:00:00.000Z',
        createId: () => 'task-2',
      },
    )

    expect(tasks[0]).toMatchObject({
      id: 'task-2',
      title: 'Review CI',
      note: 'tighten checks',
      project: 'Ops',
    })
  })

  it('updates completedAt when task status changes', () => {
    const tasks = setTaskStatus(
      [baseTask],
      baseTask.id,
      'done',
      '2026-04-15T11:00:00.000Z',
    )

    expect(tasks[0]).toMatchObject({
      status: 'done',
      completedAt: '2026-04-15T11:00:00.000Z',
    })
  })

  it('moves a task back to inbox when the planned date is cleared', () => {
    const tasks = setTaskPlannedDate([baseTask], baseTask.id, null)

    expect(tasks[0]?.plannedDate).toBeNull()
  })

  it('groups tasks by project and falls back to No project', () => {
    const groups = groupTasksByProject([
      baseTask,
      {
        ...baseTask,
        id: 'task-2',
        project: ' ',
      },
    ])

    expect(groups).toEqual([
      ['No project', [expect.objectContaining({ id: 'task-2' })]],
      ['Planner', [expect.objectContaining({ id: 'task-1' })]],
    ])
  })

  it('builds summary counters for the sidebar', () => {
    const summary = getPlannerSummary(
      [
        baseTask,
        {
          ...baseTask,
          id: 'task-2',
          plannedDate: null,
        },
        {
          ...baseTask,
          id: 'task-3',
          plannedDate: '2026-04-14',
        },
        {
          ...baseTask,
          id: 'task-4',
          status: 'done',
          completedAt: '2026-04-15T12:00:00.000Z',
        },
      ],
      '2026-04-15',
    )

    expect(summary).toEqual({
      focusCount: 1,
      inboxCount: 1,
      overdueCount: 1,
      doneTodayCount: 1,
      projectCount: 1,
    })
  })
})
