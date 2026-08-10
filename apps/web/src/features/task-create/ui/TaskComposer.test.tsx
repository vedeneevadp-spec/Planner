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
