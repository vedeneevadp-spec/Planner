import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  Task,
  TaskScheduleInput,
  TaskStatus,
  TaskUpdateInput,
} from '@/entities/task'

import { CalendarDayScheduleDialog } from './CalendarDayScheduleDialog'

const TODAY_KEY = '2026-05-27'

vi.mock('@/entities/task', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    TaskEditDialog: ({ task }: { task: Task }) => (
      <div role="dialog" aria-label={`Редактировать ${task.title}`} />
    ),
  }
})

interface DialogMocks {
  isTaskPending: (taskId: string) => boolean
  onClose: () => void
  onRemove: (taskId: string) => void
  onSetPlannedDate: (taskId: string, plannedDate: string | null) => void
  onSetSchedule: (taskId: string, schedule: TaskScheduleInput) => void
  onSetStatus: (taskId: string, status: TaskStatus) => void
  onUpdate: (taskId: string, input: TaskUpdateInput) => Promise<boolean>
}

describe('CalendarDayScheduleDialog', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders a pluralized title and closes from the dialog controls', () => {
    const mocks = createMocks()
    const { rerender } = renderDialog({
      mocks,
      tasks: [createTask({ id: 'task-1' })],
    })

    expect(
      screen.getByRole('heading', { name: 'Распределить 1 задача' }),
    ).toBeVisible()

    rerender(
      <CalendarDayScheduleDialog
        {...mocks}
        spheres={[]}
        tasks={[createTask({ id: 'task-1' }), createTask({ id: 'task-2' })]}
        todayKey={TODAY_KEY}
        uploadedIcons={[]}
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'Распределить 2 задачи' }),
    ).toBeVisible()

    rerender(
      <CalendarDayScheduleDialog
        {...mocks}
        spheres={[]}
        tasks={Array.from({ length: 5 }, (_, index) =>
          createTask({ id: `task-${index}` }),
        )}
        todayKey={TODAY_KEY}
        uploadedIcons={[]}
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'Распределить 5 задач' }),
    ).toBeVisible()

    rerender(
      <CalendarDayScheduleDialog
        {...mocks}
        spheres={[]}
        tasks={Array.from({ length: 11 }, (_, index) =>
          createTask({ id: `task-${index}` }),
        )}
        todayKey={TODAY_KEY}
        uploadedIcons={[]}
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'Распределить 11 задач' }),
    ).toBeVisible()

    fireEvent.click(
      screen.getByRole('button', { name: 'Закрыть распределение задач' }),
    )

    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('saves and clears the task schedule', () => {
    const mocks = createMocks()
    renderDialog({ mocks })

    fireEvent.change(screen.getByLabelText('Старт'), {
      target: { value: '09:00' },
    })
    fireEvent.change(screen.getByLabelText('Финиш'), {
      target: { value: '10:30' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(mocks.onSetSchedule).toHaveBeenCalledWith('task-1', {
      plannedDate: '2026-05-27',
      plannedEndTime: '10:30',
      plannedStartTime: '09:00',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))

    expect(mocks.onSetSchedule).toHaveBeenLastCalledWith('task-1', {
      plannedDate: '2026-05-27',
      plannedEndTime: null,
      plannedStartTime: null,
    })
  })

  it('blocks invalid time ranges', () => {
    renderDialog()

    fireEvent.change(screen.getByLabelText('Старт'), {
      target: { value: '10:00' },
    })
    fireEvent.change(screen.getByLabelText('Финиш'), {
      target: { value: '09:30' },
    })

    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    expect(screen.getByText('Финиш должен быть позже старта.')).toBeVisible()
  })

  it('runs task menu actions', () => {
    const mocks = createMocks()
    renderDialog({ mocks })

    fireEvent.click(screen.getByRole('button', { name: 'Действия с задачей' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Завершить' }))

    expect(mocks.onSetStatus).toHaveBeenCalledWith('task-1', 'done')

    fireEvent.click(screen.getByRole('button', { name: 'Действия с задачей' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Отложить' }))

    expect(mocks.onSetPlannedDate).toHaveBeenCalledWith('task-1', null)

    fireEvent.click(screen.getByRole('button', { name: 'Действия с задачей' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }))

    expect(mocks.onRemove).toHaveBeenCalledWith('task-1')

    fireEvent.click(screen.getByRole('button', { name: 'Действия с задачей' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Редактировать' }))

    expect(
      screen.getByRole('dialog', { name: 'Редактировать Задача без времени' }),
    ).toBeVisible()
  })
})

function createMocks(): DialogMocks {
  return {
    isTaskPending: () => false,
    onClose: vi.fn(),
    onRemove: vi.fn(),
    onSetPlannedDate: vi.fn(),
    onSetSchedule: vi.fn(),
    onSetStatus: vi.fn(),
    onUpdate: vi.fn<DialogMocks['onUpdate']>().mockResolvedValue(true),
  }
}

function renderDialog({
  mocks = createMocks(),
  tasks = [createTask()],
}: {
  mocks?: DialogMocks
  tasks?: Task[]
} = {}) {
  return render(
    <CalendarDayScheduleDialog
      {...mocks}
      spheres={[]}
      tasks={tasks}
      todayKey={TODAY_KEY}
      uploadedIcons={[]}
    />,
  )
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: '2026-05-27T08:00:00.000Z',
    dueDate: null,
    icon: '',
    id: 'task-1',
    importance: 'not_important',
    necessity: 'desired',
    note: 'Заметка',
    plannedDate: '2026-05-27',
    plannedEndTime: null,
    plannedStartTime: null,
    project: 'Проект',
    projectId: null,
    requiresConfirmation: false,
    resource: null,
    sphereId: null,
    status: 'todo',
    title: 'Задача без времени',
    urgency: 'not_urgent',
    ...overrides,
  }
}
