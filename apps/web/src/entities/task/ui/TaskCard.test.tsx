import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/entities/task'

import { TaskCard } from './TaskCard'

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    completedAt: null,
    createdAt: '2026-04-20T08:00:00.000Z',
    dueDate: null,
    icon: '',
    id: 'task-1',
    importance: 'not_important',
    note: '',
    plannedDate: '2026-04-23',
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    resource: null,
    sphereId: null,
    status: 'todo',
    title: 'Task',
    urgency: 'not_urgent',
    ...overrides,
  }
}

function renderTaskCard(task: Task) {
  return render(
    <TaskCard
      task={task}
      onRemove={vi.fn()}
      onSetPlannedDate={vi.fn()}
      onSetStatus={vi.fn()}
      onUpdate={vi.fn(() => Promise.resolve(true))}
    />,
  )
}

describe('TaskCard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-23T10:00:00'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows postpone action for today and tomorrow tasks', () => {
    const { rerender } = renderTaskCard(
      createTask({ plannedDate: '2026-04-23' }),
    )

    expect(screen.getByRole('button', { name: 'Отложить' })).toBeInTheDocument()

    rerender(
      <TaskCard
        task={createTask({ plannedDate: '2026-04-24' })}
        onRemove={vi.fn()}
        onSetPlannedDate={vi.fn()}
        onSetStatus={vi.fn()}
        onUpdate={vi.fn(() => Promise.resolve(true))}
      />,
    )

    expect(screen.getByRole('button', { name: 'Отложить' })).toBeInTheDocument()
  })

  it('hides postpone action for tasks planned after tomorrow', () => {
    renderTaskCard(createTask({ plannedDate: '2026-04-27' }))

    expect(
      screen.queryByRole('button', { name: 'Отложить' }),
    ).not.toBeInTheDocument()
  })
})
