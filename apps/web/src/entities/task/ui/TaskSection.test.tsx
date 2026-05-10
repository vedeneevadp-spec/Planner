import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/entities/task'

import { TaskSection } from './TaskSection'

vi.mock('./TaskCard', () => ({
  TaskCard: ({
    isPending,
    onActionMenuOpenChange,
    project,
    task,
  }: {
    isPending?: boolean
    onActionMenuOpenChange: (taskId: string, isOpen: boolean) => void
    project?: { title: string }
    task: Task
  }) => (
    <article data-testid={`task-${task.id}`}>
      <span>{task.title}</span>
      <span>{project?.title ?? 'no-project'}</span>
      <span>{isPending ? 'pending' : 'ready'}</span>
      <button
        type="button"
        onClick={() => onActionMenuOpenChange(task.id, true)}
      >
        open {task.title}
      </button>
      <button
        type="button"
        onClick={() => onActionMenuOpenChange(task.id, false)}
      >
        close {task.title}
      </button>
    </article>
  ),
}))

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
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    requiresConfirmation: false,
    resource: null,
    sphereId: null,
    status: 'todo',
    title: 'Task',
    urgency: 'not_urgent',
    ...overrides,
  }
}

function renderTaskSection(
  props: Partial<ComponentProps<typeof TaskSection>> = {},
) {
  return render(
    <TaskSection
      title="Сегодня"
      tasks={[]}
      emptyMessage="Задач нет"
      onRemove={vi.fn()}
      onSetPlannedDate={vi.fn()}
      onSetStatus={vi.fn()}
      onUpdate={vi.fn(() => Promise.resolve(true))}
      {...props}
    />,
  )
}

describe('TaskSection', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows empty copy and collapses content', () => {
    renderTaskSection()

    expect(screen.getByText('Задач нет')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()

    const collapseButton = screen.getByRole('button', { name: 'Сегодня' })
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(collapseButton)

    expect(collapseButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Задач нет')).not.toBeInTheDocument()
  })

  it('renders tasks with matching project and pending state', () => {
    renderTaskSection({
      isTaskPending: (taskId) => taskId === 'task-1',
      projects: [
        {
          color: '#2f80ed',
          createdAt: '2026-04-20T08:00:00.000Z',
          deletedAt: null,
          description: '',
          icon: '🏠',
          id: 'project-1',
          status: 'active',
          title: 'Дом',
          updatedAt: '2026-04-20T08:00:00.000Z',
          version: 1,
          workspaceId: 'workspace-1',
        },
      ],
      tasks: [createTask({ projectId: 'project-1', title: 'Разобрать inbox' })],
    })

    expect(screen.getByTestId('task-task-1')).toHaveTextContent(
      'Разобрать inbox',
    )
    expect(screen.getByTestId('task-task-1')).toHaveTextContent('Дом')
    expect(screen.getByTestId('task-task-1')).toHaveTextContent('pending')
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('keeps only one task action menu marked as open', () => {
    renderTaskSection({
      tasks: [
        createTask({ id: 'task-1', title: 'Первая' }),
        createTask({ id: 'task-2', title: 'Вторая' }),
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: 'open Первая' }))
    fireEvent.click(screen.getByRole('button', { name: 'open Вторая' }))
    fireEvent.click(screen.getByRole('button', { name: 'close Первая' }))

    expect(screen.getByTestId('task-task-1')).toBeInTheDocument()
    expect(screen.getByTestId('task-task-2')).toBeInTheDocument()
  })
})
