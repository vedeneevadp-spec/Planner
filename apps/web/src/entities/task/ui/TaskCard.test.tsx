import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/entities/task'

import { TaskCard } from './TaskCard'

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
    id: 'task-1',
    importance: 'not_important',
    note: '',
    plannedDate: '2026-04-23',
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    resource: null,
    requiresConfirmation: false,
    sphereId: null,
    status: 'todo',
    title: 'Task',
    urgency: 'not_urgent',
    ...overrides,
  }
}

function renderTaskCard(
  task: Task,
  props: Partial<ComponentProps<typeof TaskCard>> = {},
) {
  return render(
    <TaskCard
      task={task}
      onRemove={vi.fn()}
      onSetPlannedDate={vi.fn()}
      onSetStatus={vi.fn()}
      onUpdate={vi.fn(() => Promise.resolve(true))}
      {...props}
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

  it('shows review action for shared workspace assignees', () => {
    renderTaskCard(
      createTask({
        assigneeDisplayName: 'Assignee',
        assigneeUserId: 'user-2',
        requiresConfirmation: true,
      }),
      {
        currentActorUserId: 'user-2',
        isSharedWorkspace: true,
        sharedWorkspaceGroupRole: 'member',
      },
    )

    expect(
      screen.getByRole('button', { name: 'На проверку' }),
    ).toBeInTheDocument()
  })

  it('hides review action when confirmation is not required', () => {
    renderTaskCard(
      createTask({
        assigneeDisplayName: 'Assignee',
        assigneeUserId: 'user-2',
        requiresConfirmation: false,
      }),
      {
        currentActorUserId: 'user-2',
        isSharedWorkspace: true,
        sharedWorkspaceGroupRole: 'member',
      },
    )

    expect(
      screen.queryByRole('button', { name: 'На проверку' }),
    ).not.toBeInTheDocument()
  })

  it('hides project metadata in shared workspace task cards', () => {
    renderTaskCard(
      createTask({
        project: 'Семья',
      }),
      {
        isSharedWorkspace: true,
      },
    )

    expect(screen.queryByText('Семья')).not.toBeInTheDocument()
    expect(screen.queryByText('Без проекта')).not.toBeInTheDocument()
    expect(screen.queryByText('Без сферы')).not.toBeInTheDocument()
  })

  it('limits shared task assignees to work and review status changes', () => {
    renderTaskCard(
      createTask({
        assigneeDisplayName: 'Assignee',
        assigneeUserId: 'user-2',
        authorDisplayName: 'Author',
        authorUserId: 'user-1',
        requiresConfirmation: true,
      }),
      {
        currentActorUserId: 'user-2',
        isSharedWorkspace: true,
        sharedWorkspaceGroupRole: 'member',
      },
    )

    expect(screen.getByRole('button', { name: 'В работе' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'На проверку' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Отложить' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Завершить задачу' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Подтвердить выполнение задачи' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Редактировать задачу' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Удалить задачу' }),
    ).not.toBeInTheDocument()
  })

  it('shows shared workspace tasks as read-only for unrelated members', () => {
    renderTaskCard(
      createTask({
        assigneeDisplayName: 'Assignee',
        assigneeUserId: 'user-2',
        authorDisplayName: 'Author',
        authorUserId: 'user-1',
      }),
      {
        currentActorUserId: 'user-3',
        isSharedWorkspace: true,
        sharedWorkspaceGroupRole: 'member',
      },
    )

    expect(
      screen.queryByRole('button', { name: 'В работе' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'На проверку' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Отложить' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Редактировать задачу' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Удалить задачу' }),
    ).not.toBeInTheDocument()
  })

  it('does not treat shared workspace role admin as task manager without group_admin', () => {
    renderTaskCard(
      createTask({
        assigneeDisplayName: 'Assignee',
        assigneeUserId: 'user-2',
        authorDisplayName: 'Author',
        authorUserId: 'user-1',
      }),
      {
        currentActorUserId: 'user-3',
        isSharedWorkspace: true,
        sharedWorkspaceGroupRole: 'member',
        sharedWorkspaceRole: 'admin',
      },
    )

    expect(
      screen.queryByRole('button', { name: 'В работе' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'На проверку' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Отложить' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Редактировать задачу' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Удалить задачу' }),
    ).not.toBeInTheDocument()
  })

  it('allows shared workspace admins to edit and move confirmed tasks without completing them', () => {
    renderTaskCard(
      createTask({
        authorDisplayName: 'Author',
        authorUserId: 'user-1',
        requiresConfirmation: true,
      }),
      {
        currentActorUserId: 'user-2',
        isSharedWorkspace: true,
        sharedWorkspaceGroupRole: 'group_admin',
      },
    )

    expect(screen.getByRole('button', { name: 'В работе' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отложить' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Редактировать задачу' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Подтвердить выполнение задачи' }),
    ).not.toBeInTheDocument()
  })

  it('keeps shared workspace admins limited to status actions on tasks assigned to them', () => {
    renderTaskCard(
      createTask({
        assigneeDisplayName: 'Admin Assignee',
        assigneeUserId: 'user-2',
        authorDisplayName: 'Author',
        authorUserId: 'user-1',
        requiresConfirmation: true,
      }),
      {
        currentActorUserId: 'user-2',
        isSharedWorkspace: true,
        sharedWorkspaceGroupRole: 'group_admin',
      },
    )

    expect(screen.getByRole('button', { name: 'В работе' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'На проверку' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Отложить' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Редактировать задачу' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Удалить задачу' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Подтвердить выполнение задачи' }),
    ).not.toBeInTheDocument()
  })
})
