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
    expect(screen.getByText('спокойно')).toBeVisible()
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
    expect(screen.getByText(/План выглядит реалистично/)).toBeVisible()

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
