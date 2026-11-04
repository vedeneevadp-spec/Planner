import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addTask: vi.fn(),
  createHabit: vi.fn(),
}))

vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    addEventListener: vi.fn(),
    matches: false,
    removeEventListener: vi.fn(),
  })),
)

vi.mock('@/features/emoji-library', () => ({
  useUploadedIconAssets: () => ({ uploadedIcons: [] }),
}))

vi.mock('@/features/habits', () => ({
  useCreateHabit: () => ({
    isPending: false,
    mutateAsync: mocks.createHabit,
  }),
}))

vi.mock('@/features/planner', () => ({
  usePlanner: () => ({
    addTask: mocks.addTask,
    spheres: [],
  }),
}))

vi.mock('@/features/session', () => ({
  usePlannerSession: () => ({
    data: {
      actorUserId: 'user-1',
      workspace: { kind: 'personal' },
      workspaceId: 'workspace-1',
    },
  }),
  usePlannerTimeZone: () => 'Asia/Novosibirsk',
  useWorkspaceUsers: () => ({ data: { users: [] } }),
}))

import { TaskComposer } from './TaskComposer'

describe('TaskComposer', () => {
  beforeEach(() => {
    mocks.addTask.mockReset()
    mocks.createHabit.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('creates a flexible task without opening scheduling and resets to that default', async () => {
    mocks.addTask.mockResolvedValue(true)
    render(<TaskComposer initialPlannedDate={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Новая задача' }))
    expect(screen.getByLabelText('План')).not.toBeVisible()
    expect(screen.getByLabelText('Старт')).not.toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Указать дату' }),
    ).toHaveAttribute('aria-expanded', 'false')
    fireEvent.change(screen.getByRole('textbox', { name: 'Задача' }), {
      target: { value: 'Разобрать документы' },
    })
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Добавить задачу' }).at(-1)!,
    )

    await waitFor(() =>
      expect(mocks.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          plannedDate: null,
          plannedStartTime: null,
          plannedEndTime: null,
          reminderOffsets: [],
          title: 'Разобрать документы',
        }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Новая задача' }))
    expect(screen.getByLabelText('План')).not.toBeVisible()
  })

  it('removes a chosen schedule without losing importance, recurrence, resource or note', async () => {
    mocks.addTask.mockResolvedValue(true)
    render(<TaskComposer initialPlannedDate={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Новая задача' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Задача' }), {
      target: { value: 'Проверять документы' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Заметка' }), {
      target: { value: 'Паспорта и страховки' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Пометить как важное' }))
    fireEvent.click(screen.getByRole('button', { name: 'По возможности' }))
    fireEvent.click(screen.getByRole('button', { name: 'Расход 2' }))
    fireEvent.click(screen.getByLabelText('Повторять задачу'))
    expect(screen.getByLabelText('План')).not.toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Указать дату' }))
    fireEvent.change(screen.getByLabelText('План'), {
      target: { value: '2026-11-06' },
    })
    fireEvent.change(screen.getByLabelText('Старт'), {
      target: { value: '18:00' },
    })
    expect(screen.getByText('Напомнить')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Оставить без даты' }))
    expect(screen.getByLabelText('План')).not.toBeVisible()
    expect(screen.queryByText('Напомнить')).toBeNull()
    expect(screen.getByLabelText('Повторять задачу')).toBeChecked()

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Добавить задачу' }).at(-1)!,
    )
    await waitFor(() =>
      expect(mocks.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          plannedDate: null,
          plannedStartTime: null,
          plannedEndTime: null,
          reminderOffsets: [],
          importance: 'important',
          necessity: 'optional',
          resource: -2,
          note: 'Паспорта и страховки',
        }),
      ),
    )
    expect(mocks.addTask.mock.calls[0]?.[0]).toMatchObject({
      recurrence: { isActive: true },
    })
  })

  it('respects an explicitly undated draft even in a dated context', () => {
    render(
      <TaskComposer
        initialPlannedDate="2026-11-04"
        openDraft={{ requestId: 'flexible', plannedDate: null }}
      />,
    )

    expect(screen.getByLabelText('План')).toHaveValue('')
    expect(screen.getByLabelText('План')).not.toBeVisible()
  })

  it('prefills a calendar draft and preserves its date even when the selected hour has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T08:00:00Z'))
    mocks.addTask.mockResolvedValue(true)
    const { rerender } = render(
      <TaskComposer
        initialPlannedDate="2026-10-08"
        openDraft={{
          requestId: 'calendar-slot-1',
          plannedDate: '2026-10-08',
          plannedStartTime: '09:00',
          preservePlannedDate: true,
        }}
      />,
    )

    expect(screen.getByLabelText('План')).toHaveValue('2026-10-08')
    expect(screen.getByLabelText('Старт')).toHaveValue('09:00')
    fireEvent.change(screen.getByRole('textbox', { name: 'Задача' }), {
      target: { value: 'Задача из календаря' },
    })
    // The calendar consumes its URL trigger before the user submits the form.
    rerender(<TaskComposer initialPlannedDate="2026-10-08" openDraft={null} />)
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Добавить задачу' }).at(-1)!,
    )

    await waitFor(() =>
      expect(mocks.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          plannedDate: '2026-10-08',
          plannedStartTime: '09:00',
          reminderOffsets: [15],
        }),
      ),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Новая задача' }))
    expect(screen.getByLabelText('План')).toHaveValue('2026-10-08')
    expect(screen.getByLabelText('Старт')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))

    rerender(
      <TaskComposer
        initialPlannedDate="2026-10-08"
        openDraft={{
          requestId: 'calendar-slot-2',
          plannedDate: '2026-10-11',
          plannedStartTime: '23:00',
          preservePlannedDate: true,
        }}
      />,
    )
    expect(screen.getByLabelText('План')).toHaveValue('2026-10-11')
    expect(screen.getByLabelText('Старт')).toHaveValue('23:00')
    expect(screen.getByRole('textbox', { name: 'Задача' })).toHaveValue('')
  })

  it('locks a slow task submission synchronously and closes after local acceptance', async () => {
    const deferred = createDeferred<boolean>()
    const callbackDeferred = createDeferred<void>()
    const onTaskCreated = vi.fn(() => callbackDeferred.promise)
    mocks.addTask.mockReturnValue(deferred.promise)

    render(
      <TaskComposer
        initialPlannedDate="2026-08-10"
        onTaskCreated={onTaskCreated}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Новая задача' }))
    const dialog = screen.getByRole('dialog', { name: 'Новая задача' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Задача' }), {
      target: { value: 'Одна задача' },
    })

    const form = dialog.querySelector('form')
    expect(form).not.toBeNull()

    act(() => {
      form!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
      form!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    })

    expect(mocks.addTask).toHaveBeenCalledTimes(1)
    expect(dialog).toHaveAttribute('aria-busy', 'true')
    expect(
      screen.getAllByRole('button', { name: 'Сохраняем…' }),
    ).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeDisabled()

    await act(async () => {
      deferred.resolve(true)
      await deferred.promise
    })

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Новая задача' }),
      ).not.toBeInTheDocument()
    })
    expect(onTaskCreated).toHaveBeenCalledTimes(1)

    await act(async () => {
      callbackDeferred.resolve()
      await callbackDeferred.promise
    })
  })

  it('unlocks the form when local task acceptance fails', async () => {
    mocks.addTask.mockResolvedValue(false)

    render(<TaskComposer initialPlannedDate={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Новая задача' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Задача' }), {
      target: { value: 'Повторяемая задача' },
    })
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Добавить задачу' }).at(-1)!,
    )

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: 'Новая задача' }),
      ).not.toHaveAttribute('aria-busy')
    })
    expect(
      screen.getAllByRole('button', { name: 'Добавить задачу' }).at(-1),
    ).toBeEnabled()
  })
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}
