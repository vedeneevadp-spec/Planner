import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    necessity: 'desired',
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
    loadOfflineConflictGroups: vi.fn().mockResolvedValue([]),
    resolveOfflineConflict: vi.fn().mockResolvedValue(undefined),
    copyTaskToPersonal: vi.fn(),
    createNextTaskStage: vi.fn(),
    debugErrorDetails: null,
    detachTaskFromChain: vi.fn(),
    errorMessage: null,
    hasLifeSphereRecords: true,
    hasLifeSphereReadError: false,
    hasReadError: false,
    hasTaskRecords: true,
    hasTaskReadError: false,
    isTaskReadFetching: false,
    hasTaskTemplateReadError: false,
    isLifeSphereCacheHydrating: false,
    isLifeSphereOffline: false,
    isLoading: false,
    isOffline: false,
    isTaskOffline: false,
    isTaskCacheHydrating: false,
    isTaskTemplateCacheHydrating: false,
    isTaskTemplateOffline: false,
    isSyncing: false,
    isTaskPending: vi.fn(() => false),
    lifeSphereLastSuccessfulSyncAt: '2026-04-20T08:00:00.000Z',
    moveTaskToPersonal: vi.fn(),
    lastSuccessfulSyncAt: '2026-04-20T08:00:00.000Z',
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
    taskLastSuccessfulSyncAt: '2026-04-20T08:00:00.000Z',
    taskReadModelCoverage: null,
    taskTemplateLastSuccessfulSyncAt: '2026-04-20T08:00:00.000Z',
    tasks: [createTask()],
    taskTemplates: [],
    undoNextTaskStage: vi.fn(),
    updateSphere: vi.fn(),
    updateTask: vi.fn(),
    ...overrides,
  }
}

async function renderPlannerProvider() {
  await act(async () => {
    render(
      <PlannerProvider>
        <div>Planner content</div>
      </PlannerProvider>,
    )
    await import('./PlannerTaskActionSnackbar')
  })
}

describe('PlannerProvider', () => {
  it('shows retained input and requires an explicit second action before discarding a refused group', async () => {
    const resolveOfflineConflict = vi.fn().mockResolvedValue(undefined)
    const loadOfflineConflictGroups = vi.fn().mockResolvedValue([
      {
        id: 'refused-command',
        mutations: [
          {
            actorUserId: 'user-1',
            attemptCount: 1,
            conflictActualVersion: null,
            conflictExpectedVersion: null,
            conflictCode: 'task_manage_forbidden',
            createdAt: '2026-09-14T00:00:00.000Z',
            updatedAt: '2026-09-14T00:00:00.000Z',
            id: 'refused-command',
            lastError: 'Нет прав на изменение задачи',
            status: 'conflicted',
            workspaceId: 'workspace-1',
            type: 'task.update',
            taskId: 'task-1',
            expectedVersion: 4,
            input: { title: 'Мой заголовок', note: 'Не потерять заметку' },
          },
        ],
      },
    ])
    mocks.usePlannerState.mockReturnValue(
      createPlannerState({
        conflictedMutationCount: 1,
        loadOfflineConflictGroups,
        resolveOfflineConflict,
      }),
    )
    await renderPlannerProvider()
    fireEvent.click(
      await screen.findByText('Несинхронизированные изменения (1)'),
    )
    expect(
      await screen.findByText('Нет прав на изменение задачи'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Версия на сервере изменилась/),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Сохранённые данные'))
    expect(screen.getByText(/Не потерять заметку/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить из очереди…' }))
    expect(resolveOfflineConflict).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(resolveOfflineConflict).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить из очереди…' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Удалить группу окончательно' }),
    )
    expect(resolveOfflineConflict).toHaveBeenCalledWith(
      'refused-command',
      'discard',
    )
  })

  beforeEach(() => {
    mocks.usePlannerState.mockReturnValue(createPlannerState())
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('does not offer the next stage action for a regular completion notice', async () => {
    mocks.usePlannerState.mockReturnValue(
      createPlannerState({
        taskActionSnackbar: {
          id: 'snackbar-1',
          message: 'Выполнено',
        },
      }),
    )

    await renderPlannerProvider()

    expect(await screen.findByRole('status')).toHaveTextContent('Выполнено')
    expect(
      screen.queryByRole('button', { name: 'Создать следующий этап' }),
    ).not.toBeInTheDocument()
  })

  it('shows soft chain actions after completing a chain stage', async () => {
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

    await renderPlannerProvider()

    const snackbar = await screen.findByRole('status')
    const setPointerCapture = vi.fn()
    Object.defineProperty(snackbar, 'setPointerCapture', {
      configurable: true,
      value: setPointerCapture,
    })
    const closeChainButton = screen.getByRole('button', {
      name: 'Завершить цепочку',
    })

    expect(
      screen.getByRole('button', { name: 'Создать следующий этап' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Поставить на ожидание' }),
    ).not.toBeInTheDocument()

    fireEvent.pointerDown(closeChainButton, {
      button: 0,
      clientX: 220,
      clientY: 20,
      pointerId: 1,
    })
    expect(setPointerCapture).not.toHaveBeenCalled()

    fireEvent.click(closeChainButton)

    expect(closeTaskChain).toHaveBeenCalledWith('task-1')
  })

  it('closes the snackbar with a horizontal swipe', async () => {
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

    await renderPlannerProvider()

    const snackbar = await screen.findByRole('status')

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
