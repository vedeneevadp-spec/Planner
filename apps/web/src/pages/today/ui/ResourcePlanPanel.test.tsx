import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/entities/task'

import { ResourcePlanPanel } from './ResourcePlanPanel'

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: '2026-05-19T08:00:00.000Z',
    dueDate: null,
    icon: '',
    id: 'task-1',
    importance: 'not_important',
    necessity: 'desired',
    note: '',
    plannedDate: '2026-05-20',
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    requiresConfirmation: false,
    resource: -1,
    sphereId: null,
    status: 'todo',
    title: 'Задача',
    urgency: 'not_urgent',
    ...overrides,
  }
}

describe('ResourcePlanPanel', () => {
  afterEach(() => {
    cleanup()
  })

  it('starts collapsed and exposes the selected mode after expansion', () => {
    const onEnergyModeChange = vi.fn()

    render(
      <ResourcePlanPanel
        energyMode="normal"
        tasks={[]}
        onEnergyModeChange={onEnergyModeChange}
        onMoveTaskTomorrow={vi.fn()}
      />,
    )

    const toggle = screen.getByRole('button', {
      name: 'Открыть антиперегруз',
    })

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('нет задач')).toBeVisible()
    expect(screen.getByLabelText('Установленный режим: Норм')).toBeVisible()
    expect(
      screen.queryByRole('heading', {
        name: 'Сколько у тебя ресурса сегодня?',
      }),
    ).not.toBeInTheDocument()

    fireEvent.click(toggle)

    expect(
      screen.getByRole('heading', {
        name: 'Сколько у тебя ресурса сегодня?',
      }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: /Норм/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('Задач для расчёта пока нет.')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /Максимум/ }))

    expect(onEnergyModeChange).toHaveBeenCalledWith('maximum')
  })

  it('shows the current edge state while collapsed', () => {
    render(
      <ResourcePlanPanel
        energyMode="normal"
        tasks={[
          createTask({ id: 'edge-1', resource: -4 }),
          createTask({ id: 'edge-2', resource: -3 }),
        ]}
        onEnergyModeChange={vi.fn()}
        onMoveTaskTomorrow={vi.fn()}
      />,
    )

    expect(screen.getByText('на грани')).toBeVisible()
  })

  it('keeps twelve unassessed tasks unknown in collapsed and expanded views', () => {
    render(
      <ResourcePlanPanel
        energyMode="normal"
        tasks={Array.from({ length: 12 }, (_, index) =>
          createTask({ id: String(index), resource: null }),
        )}
        onEnergyModeChange={vi.fn()}
        onMoveTaskTomorrow={vi.fn()}
      />,
    )
    expect(screen.getByText('Оценено 0 из 12')).toBeVisible()
    expect(screen.getByText('неполная оценка')).toBeVisible()
    expect(screen.queryByText('спокойно')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Открыть антиперегруз' }),
    )
    expect(screen.getByText(/Нагрузка пока неизвестна/)).toBeVisible()
    expect(screen.getByText('— из 8 ресурса')).toBeVisible()
    expect(
      screen.queryByText(/План.*(реалистич|укладывается)/),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'На завтра' }),
    ).not.toBeInTheDocument()
  })

  it('counts an explicit neutral zero and recovers after all tasks are assessed', () => {
    const props = {
      energyMode: 'normal' as const,
      onEnergyModeChange: vi.fn(),
      onMoveTaskTomorrow: vi.fn(),
    }
    const { rerender } = render(
      <ResourcePlanPanel
        {...props}
        tasks={[
          createTask({ resource: 0 }),
          createTask({ id: 'unknown', resource: null }),
        ]}
      />,
    )
    expect(screen.getByText('Оценено 1 из 2')).toBeVisible()
    expect(screen.getByText('неполная оценка')).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', { name: 'Открыть антиперегруз' }),
    )
    expect(screen.getByText(/Без оценки: 1/)).toBeVisible()
    expect(
      screen.queryByText(/План задач укладывается/),
    ).not.toBeInTheDocument()
    rerender(
      <ResourcePlanPanel
        {...props}
        tasks={[
          createTask({ resource: 0 }),
          createTask({ id: 'unknown', resource: -2 }),
        ]}
      />,
    )
    expect(screen.getByText('Оценено 2 из 2')).toBeVisible()
    expect(screen.getByText('спокойно')).toBeVisible()
    expect(
      screen.getByText('План задач укладывается в выбранный лимит.'),
    ).toBeVisible()
  })

  it('qualifies a high known subtotal without calling the whole day overloaded', () => {
    render(
      <ResourcePlanPanel
        energyMode="minimum"
        tasks={[
          createTask({ resource: -4 }),
          createTask({ id: 'rated-2', resource: -2 }),
          createTask({ id: 'unknown', resource: null }),
        ]}
        onEnergyModeChange={vi.fn()}
        onMoveTaskTomorrow={vi.fn()}
      />,
    )
    expect(screen.getByText('неполная оценка')).toBeVisible()
    expect(screen.queryByText('перегруз')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Открыть антиперегруз' }),
    )
    expect(
      screen.getByRole('heading', { name: 'Оценённая часть выше лимита' }),
    ).toBeVisible()
    expect(screen.getByText('6 из 4 ресурса')).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'На завтра' })).toHaveLength(2)
    expect(
      screen.queryByText('Похоже, день перегружен'),
    ).not.toBeInTheDocument()
  })

  it.each([{ tasks: [] }, { tasks: [createTask({ resource: 0 })] }])(
    'never concludes from incomplete task data',
    ({ tasks }) => {
      render(
        <ResourcePlanPanel
          energyMode="normal"
          isTaskDataComplete={false}
          tasks={tasks}
          onEnergyModeChange={vi.fn()}
          onMoveTaskTomorrow={vi.fn()}
        />,
      )
      expect(screen.getByText('неполная оценка')).toBeVisible()
      expect(screen.getByText(/по загруженным задачам/)).toBeVisible()
      expect(screen.queryByText('нет задач')).not.toBeInTheDocument()
      fireEvent.click(
        screen.getByRole('button', { name: 'Открыть антиперегруз' }),
      )
      expect(
        screen.getByText(/Список задач может быть неполным или устаревшим/),
      ).toBeVisible()
      expect(
        screen.queryByText(/План задач укладывается/),
      ).not.toBeInTheDocument()
    },
  )

  it('keeps unload ordering, pending state and tomorrow callback', () => {
    const onMoveTaskTomorrow = vi.fn()

    render(
      <ResourcePlanPanel
        energyMode="normal"
        isTaskPending={(taskId) => taskId === 'heavy'}
        tasks={[
          createTask({
            createdAt: '2026-05-19T10:00:00.000Z',
            id: 'important',
            importance: 'important',
            resource: -4,
            title: 'Важная задача',
          }),
          createTask({
            createdAt: '2026-05-19T09:00:00.000Z',
            id: 'medium',
            resource: -3,
            title: 'Средняя задача',
          }),
          createTask({
            createdAt: '2026-05-19T11:00:00.000Z',
            id: 'heavy',
            resource: -4,
            title: 'Тяжёлая задача',
          }),
          createTask({
            id: 'restoring',
            resource: 1,
            title: 'Восстанавливающая задача',
          }),
        ]}
        onEnergyModeChange={vi.fn()}
        onMoveTaskTomorrow={onMoveTaskTomorrow}
      />,
    )

    expect(screen.getByText('перегруз')).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', { name: 'Открыть антиперегруз' }),
    )

    const titles = screen
      .getAllByRole('button', { name: 'На завтра' })
      .map((button) => button.parentElement?.textContent)

    expect(titles).toEqual([
      expect.stringContaining('Тяжёлая задача'),
      expect.stringContaining('Средняя задача'),
      expect.stringContaining('Важная задача'),
    ])

    const moveButtons = screen.getAllByRole('button', { name: 'На завтра' })
    expect(moveButtons[0]).toBeDisabled()
    expect(moveButtons[1]).toBeEnabled()

    fireEvent.click(moveButtons[1]!)

    expect(onMoveTaskTomorrow).toHaveBeenCalledWith('medium')
  })
})
