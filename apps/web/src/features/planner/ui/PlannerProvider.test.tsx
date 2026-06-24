import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/entities/task'

import type { PlannerState } from '../model/planner.types'
import { PlannerProvider } from './PlannerProvider'

const mocks = vi.hoisted(() => ({
  usePlannerState: vi.fn<() => PlannerState>(),
}))

vi.mock('@/features/session', () => ({
  usePlannerTimeZone: () => 'Europe/Samara',
}))

vi.mock('../model/usePlannerState', () => ({
  usePlannerState: () => mocks.usePlannerState(),
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
    resource: null,
    requiresConfirmation: false,
    sphereId: null,
    status: 'done',
    title: 'Book service',
    urgency: 'not_urgent',
    ...overrides,
  }
}

function createPlannerState(
  overrides: Partial<PlannerState> = {},
): PlannerState {
  return {
    addSphere: vi.fn(),
    addTask: vi.fn(),
    addTaskTemplate: vi.fn(),
    clearTaskActionSnackbar: vi.fn(),
    closeTaskChain: vi.fn(),
    conflictedMutationCount: 0,
    copyTaskToPersonal: vi.fn(),
    createNextTaskStage: vi.fn(),
    debugErrorDetails: null,
    detachTaskFromChain: vi.fn(),
    errorMessage: null,
    isLoading: false,
    isSyncing: false,
    isTaskPending: vi.fn(() => false),
    moveTaskToPersonal: vi.fn(),
    queuedMutationCount: 0,
    readiness: {
      canReadCachedData: true,
      canRenderAppContent: true,
      canUseProtectedApi: true,
      canWriteProtectedData: true,
      reason: 'ready',
      status: 'ready',
    },
    refresh: vi.fn(),
    removeSphere: vi.fn(),
    removeTask: vi.fn(),
    removeTaskTemplate: vi.fn(),
    setTaskPlannedDate: vi.fn(),
    setTaskSchedule: vi.fn(),
    setTaskStatus: vi.fn(),
    spheres: [],
    taskActionSnackbar: null,
    tasks: [createTask()],
    taskTemplates: [],
    undoNextTaskStage: vi.fn(),
    updateSphere: vi.fn(),
    updateTask: vi.fn(),
    ...overrides,
  }
}

function renderPlannerProvider() {
  return render(
    <PlannerProvider>
      <div>Planner content</div>
    </PlannerProvider>,
  )
}

describe('PlannerProvider', () => {
  beforeEach(() => {
    mocks.usePlannerState.mockReturnValue(createPlannerState())
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('does not offer the next stage action for a regular completion notice', () => {
    mocks.usePlannerState.mockReturnValue(
      createPlannerState({
        taskActionSnackbar: {
          id: 'snackbar-1',
          message: 'Выполнено',
        },
      }),
    )

    renderPlannerProvider()

    expect(screen.getByRole('status')).toHaveTextContent('Выполнено')
    expect(
      screen.queryByRole('button', { name: 'Создать следующий этап' }),
    ).not.toBeInTheDocument()
  })

  it('shows soft chain actions after completing a chain stage', () => {
    const closeTaskChain = vi.fn(() => Promise.resolve(true))

    mocks.usePlannerState.mockReturnValue(
      createPlannerState({
        closeTaskChain,
        taskActionSnackbar: {
          chainCompletionTaskId: 'task-1',
          id: 'snackbar-1',
          message: 'Этап выполнен',
        },
      }),
    )

    renderPlannerProvider()

    expect(
      screen.getByRole('button', { name: 'Создать следующий этап' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Поставить на ожидание' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Завершить цепочку' }))

    expect(closeTaskChain).toHaveBeenCalledWith('task-1')
  })

  it('closes the snackbar with a horizontal swipe', () => {
    const clearTaskActionSnackbar = vi.fn()

    mocks.usePlannerState.mockReturnValue(
      createPlannerState({
        clearTaskActionSnackbar,
        taskActionSnackbar: {
          id: 'snackbar-1',
          message: 'Этап выполнен',
        },
      }),
    )

    renderPlannerProvider()

    const snackbar = screen.getByRole('status')

    fireEvent.pointerDown(snackbar, {
      button: 0,
      clientX: 220,
      clientY: 20,
      pointerId: 1,
    })
    fireEvent.pointerMove(snackbar, {
      clientX: 120,
      clientY: 24,
      pointerId: 1,
    })
    fireEvent.pointerUp(snackbar, {
      clientX: 120,
      clientY: 24,
      pointerId: 1,
    })

    expect(clearTaskActionSnackbar).toHaveBeenCalledTimes(1)
  })
})
