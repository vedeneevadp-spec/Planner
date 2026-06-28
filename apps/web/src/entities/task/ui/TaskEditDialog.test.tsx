import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/entities/task'

import { TaskEditDialog } from './TaskEditDialog'

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: 'user-1',
    completedAt: null,
    createdAt: '2026-04-20T08:00:00.000Z',
    dueDate: null,
    icon: '✅',
    id: 'task-1',
    importance: 'not_important',
    necessity: 'desired',
    note: 'Old note',
    plannedDate: '2026-05-19',
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    resource: null,
    requiresConfirmation: false,
    sphereId: null,
    status: 'todo',
    title: 'Old title',
    urgency: 'not_urgent',
    ...overrides,
  }
}

describe('TaskEditDialog', () => {
  afterEach(() => {
    cleanup()
  })

  it('submits normalized personal task updates and closes after success', async () => {
    const onClose = vi.fn()
    const onUpdate = vi.fn(() => Promise.resolve(true))

    render(
      <TaskEditDialog
        currentActorUserId="user-1"
        todayKey="2026-05-19"
        task={createTask()}
        spheres={[
          {
            color: '#2f6f62',
            createdAt: '2026-05-01T08:00:00.000Z',
            deletedAt: null,
            description: '',
            icon: '🏠',
            id: 'sphere-1',
            isActive: true,
            isDefault: false,
            name: 'Дом',
            sortOrder: 1,
            updatedAt: '2026-05-01T08:00:00.000Z',
            userId: 'user-1',
            version: 1,
            workspaceId: 'workspace-1',
          },
        ]}
        uploadedIcons={[]}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    )

    fireEvent.change(screen.getByLabelText('Задача'), {
      target: { value: '  Updated title  ' },
    })
    fireEvent.change(screen.getByLabelText('План'), {
      target: { value: '2026-05-20' },
    })
    fireEvent.change(screen.getByLabelText('Старт'), {
      target: { value: '10:30' },
    })
    fireEvent.change(screen.getAllByLabelText('Финиш')[0]!, {
      target: { value: '11:00' },
    })
    fireEvent.change(screen.getByLabelText('Заметка'), {
      target: { value: 'Updated note' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Пометить как важное' }))
    fireEvent.click(screen.getByRole('button', { name: 'Обязательно' }))
    const saveButtons = screen.getAllByRole('button', { name: 'Сохранить' })
    fireEvent.click(saveButtons[saveButtons.length - 1]!)

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          assigneeUserId: null,
          importance: 'important',
          necessity: 'required',
          note: 'Updated note',
          plannedDate: '2026-05-20',
          plannedEndTime: '11:00',
          plannedStartTime: '10:30',
          remindBeforeStart: true,
          reminderOffsets: [15],
          requiresConfirmation: false,
          title: 'Updated title',
        }),
      )
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('allows shared workspace authors to assign users and require confirmation', async () => {
    const onUpdate = vi.fn(() => Promise.resolve(true))

    render(
      <TaskEditDialog
        currentActorUserId="user-1"
        isSharedWorkspace
        todayKey="2026-05-19"
        task={createTask({
          assigneeUserId: null,
          authorUserId: 'user-1',
          requiresConfirmation: false,
        })}
        spheres={[]}
        uploadedIcons={[]}
        workspaceUsers={[
          {
            displayName: 'Alex',
            email: 'alex@example.com',
            groupRole: 'member',
            id: 'user-2',
            isOwner: false,
            joinedAt: '2026-05-01T08:00:00.000Z',
            membershipId: 'membership-2',
            updatedAt: '2026-05-01T08:00:00.000Z',
          },
        ]}
        onClose={vi.fn()}
        onUpdate={onUpdate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Исполнитель' }))
    fireEvent.click(screen.getByRole('option', { name: 'Alex' }))
    fireEvent.click(screen.getByLabelText('Требуется подтверждение'))
    const saveButtons = screen.getAllByRole('button', { name: 'Сохранить' })
    fireEvent.click(saveButtons[saveButtons.length - 1]!)

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          assigneeUserId: 'user-2',
          remindBeforeStart: false,
          reminderOffsets: [],
          requiresConfirmation: true,
        }),
      )
    })
  })
})
