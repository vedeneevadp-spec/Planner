import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/entities/task'
import { addDateDays, getTodayDate } from '@/shared/time/time.service'

import { ResourcePlanWithReschedule } from './ResourcePlanWithReschedule'

const mocks = vi.hoisted(() => ({
  tasks: [] as Task[],
  move: vi.fn(),
  workspaceId: 'personal',
}))
vi.mock('@/features/planner', () => ({
  usePlanner: () => ({
    tasks: mocks.tasks,
    setTaskPlannedDate: mocks.move,
    isTaskPending: () => false,
    isTaskOffline: false,
    taskReadModelCoverage: { sources: { active: { truncated: false } } },
  }),
  usePlannerTaskCursor: () => ({
    data: { items: [], truncated: false },
    isError: false,
    isFetching: false,
  }),
  toPlannerTask: (task: Task) => task,
}))
vi.mock('@/features/session', () => ({
  usePlannerSession: () => ({ data: { workspaceId: mocks.workspaceId } }),
  usePlannerTimeZone: () => 'UTC',
}))
const today = getTodayDate('UTC')
const tomorrow = addDateDays(today, 1)
function fixture(id: string): Task {
  return {
    id,
    title: id,
    note: '',
    project: '',
    projectId: null,
    status: 'todo',
    importance: 'not_important',
    urgency: 'not_urgent',
    necessity: 'desired',
    resource: -5,
    plannedDate: today,
    plannedStartTime: null,
    plannedEndTime: null,
    dueDate: null,
    createdAt: '2026-11-01T08:00:00.000Z',
    completedAt: null,
    icon: '',
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    requiresConfirmation: false,
    sphereId: null,
  }
}
function View() {
  return (
    <ResourcePlanWithReschedule
      energyMode="normal"
      isTaskDataComplete
      tasks={mocks.tasks.filter((task) => task.plannedDate === today)}
      isTaskPending={() => false}
      onEnergyModeChange={vi.fn()}
    />
  )
}
function openPicker() {
  const expand = screen.queryByRole('button', { name: 'Открыть антиперегруз' })
  if (expand) fireEvent.click(expand)
  fireEvent.click(screen.getAllByRole('button', { name: 'Подобрать день' })[0]!)
}
describe('ResourcePlanWithReschedule', () => {
  beforeEach(() => {
    mocks.workspaceId = 'personal'
    mocks.tasks = [fixture('Документы'), fixture('Уборка')]
    mocks.move.mockReset().mockImplementation((id: string, date: string) => {
      mocks.tasks = mocks.tasks.map((task) =>
        task.id === id ? { ...task, plannedDate: date } : task,
      )
      return Promise.resolve(true)
    })
  })
  afterEach(cleanup)
  it('does not mutate on preview or cancel, and undo restores the previous date', async () => {
    render(<View />)
    openPicker()
    expect(mocks.move).not.toHaveBeenCalled()
    expect(screen.getAllByRole('radio')).toHaveLength(7)
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(mocks.move).not.toHaveBeenCalled()
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: /^Перенести на/ }))
    const undo = await screen.findByRole('button', { name: 'Отменить' })
    expect(mocks.move).toHaveBeenCalledWith('Документы', tomorrow)
    fireEvent.click(undo)
    await waitFor(() =>
      expect(mocks.move).toHaveBeenLastCalledWith('Документы', today),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Отменить' }),
      ).not.toBeInTheDocument(),
    )
  })
  it('keeps the picker open when saving fails and allows retry', async () => {
    mocks.move.mockResolvedValueOnce(false)
    render(<View />)
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: /^Перенести на/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось перенести',
    )
    expect(
      screen.queryByRole('button', { name: 'Отменить' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Перенести на/ }))
    expect(
      await screen.findByRole('button', { name: 'Отменить' }),
    ).toBeVisible()
  })
  it('refuses to undo a task rescheduled elsewhere and hides undo in another workspace', async () => {
    const { rerender } = render(<View />)
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: /^Перенести на/ }))
    await screen.findByRole('button', { name: 'Отменить' })
    mocks.tasks = mocks.tasks.map((task) =>
      task.id === 'Документы'
        ? { ...task, plannedDate: addDateDays(today, 3) }
        : task,
    )
    rerender(<View />)
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    expect(screen.getByText(/Задача уже изменилась/)).toBeVisible()
    expect(mocks.move).toHaveBeenCalledTimes(1)
    mocks.workspaceId = 'shared'
    rerender(<View />)
    expect(
      screen.queryByRole('button', { name: 'Отменить' }),
    ).not.toBeInTheDocument()
  })
})
