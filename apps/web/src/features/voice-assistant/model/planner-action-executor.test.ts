import type {
  AppRole,
  PlannerIntent,
  TaskRecord,
  VoiceActionContext,
} from '@planner/contracts'
import { describe, expect, it, vi } from 'vitest'

import {
  PlannerActionExecutor,
  type PlannerActionExecutorDependencies,
} from './planner-action-executor'

const CONTEXT: VoiceActionContext = {
  appRole: 'owner',
  now: '2026-05-29T09:00:00.000Z',
  source: 'web_push_to_talk',
  timezone: 'Asia/Novosibirsk',
  userId: 'user-1',
  workspaceId: 'workspace-1',
}

describe('PlannerActionExecutor', () => {
  it('creates task intents through the planner flow and keeps date/time on the task', async () => {
    const createTask = vi.fn().mockResolvedValue({ id: 'task-created' })
    const executor = new PlannerActionExecutor()
    const deps = createDependencies({ createTask })
    const preview = await executor.prepareAction(
      createIntent({
        date: '2026-05-30',
        intent: 'create_task',
        time: '09:00',
        title: 'стоматолог',
      }),
      CONTEXT,
      deps,
    )

    const result = await executor.executeAction(preview.id, {}, CONTEXT, deps)

    expect(result).toMatchObject({
      changedData: true,
      createdTaskId: 'task-created',
      status: 'success',
      undo: {
        createdTaskId: 'task-created',
        type: 'create_task',
      },
      visualStatus: 'Готово, задача сохранена.',
    })
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        dueDate: null,
        plannedDate: '2026-05-30',
        plannedStartTime: '09:00',
        title: 'стоматолог',
      }),
    )
    expect(createTask.mock.calls[0]?.[0]).not.toHaveProperty('event')
    expect(createTask.mock.calls[0]?.[0]).not.toHaveProperty('reminderAt')
  })

  it('marks task creation as data-changing when the planner flow returns a boolean success', async () => {
    const createTask = vi.fn().mockResolvedValue(true)
    const executor = new PlannerActionExecutor()
    const deps = createDependencies({ createTask })
    const preview = await executor.prepareAction(
      createIntent({
        intent: 'create_task',
        title: 'проверить оплату',
      }),
      CONTEXT,
      deps,
    )

    const result = await executor.executeAction(preview.id, {}, CONTEXT, deps)

    expect(result).toMatchObject({
      changedData: true,
      status: 'success',
      undo: {
        type: 'create_task',
      },
      visualStatus: 'Готово, задача сохранена.',
    })
    expect(result.createdTaskId).toEqual(expect.any(String))
    expect(result.undo?.type).toBe('create_task')

    if (result.undo?.type === 'create_task') {
      expect(result.undo.createdTaskId).toEqual(expect.any(String))
      expect(result.createdTaskId).toBe(result.undo.createdTaskId)
    }
  })

  it('creates reminder intents as planner tasks, not separate reminders', async () => {
    const createTask = vi.fn().mockResolvedValue({ id: 'task-reminder' })
    const executor = new PlannerActionExecutor()
    const deps = createDependencies({ createTask })
    const preview = await executor.prepareAction(
      createIntent({
        datePrecision: 'relative',
        intent: 'create_task',
        reminderAt: '2026-05-29T10:15',
        title: 'выключить плиту',
      }),
      CONTEXT,
      deps,
    )

    await executor.executeAction(preview.id, {}, CONTEXT, deps)

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        icon: 'bell',
        plannedDate: '2026-05-29',
        plannedStartTime: '10:15',
        remindBeforeStart: true,
        reminderOffsets: [15],
        title: 'выключить плиту',
      }),
    )
    expect(createTask.mock.calls[0]?.[0]).not.toHaveProperty('reminder')
  })

  it('adds multiple shopping items through the shopping flow', async () => {
    const createShoppingItem = vi
      .fn()
      .mockResolvedValueOnce({ id: 'shopping-1' })
      .mockResolvedValueOnce({ id: 'shopping-2' })
    const executor = new PlannerActionExecutor()
    const deps = createDependencies({ createShoppingItem })
    const preview = await executor.prepareAction(
      createIntent({
        intent: 'add_shopping_item',
        items: [{ title: 'молоко' }, { title: 'хлеб' }],
      }),
      CONTEXT,
      deps,
    )

    const result = await executor.executeAction(preview.id, {}, CONTEXT, deps)

    expect(result).toMatchObject({
      changedData: true,
      createdShoppingItemIds: ['shopping-1', 'shopping-2'],
      status: 'success',
      undo: {
        createdShoppingItemIds: ['shopping-1', 'shopping-2'],
        type: 'add_shopping_item',
      },
      visualStatus: 'Добавлено в покупки.',
    })
    expect(createShoppingItem).toHaveBeenCalledTimes(2)
    expect(createShoppingItem).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ text: 'молоко' }),
    )
    expect(createShoppingItem).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ text: 'хлеб' }),
    )
  })

  it('undoes a created task through the planner removal flow', async () => {
    const removeTask = vi.fn().mockResolvedValue(true)
    const executor = new PlannerActionExecutor()
    const deps = createDependencies({
      createTask: vi.fn().mockResolvedValue({ id: 'task-created' }),
      removeTask,
    })
    const preview = await executor.prepareAction(
      createIntent({
        intent: 'create_task',
        title: 'проверить оплату',
      }),
      CONTEXT,
      deps,
    )
    const result = await executor.executeAction(preview.id, {}, CONTEXT, deps)

    const undoResult = await executor.undoAction(result, deps)

    expect(removeTask).toHaveBeenCalledWith('task-created')
    expect(undoResult).toMatchObject({
      changedData: true,
      status: 'success',
      visualStatus: 'Создание задачи отменено.',
    })
  })

  it('undoes created shopping items through the shopping removal flow', async () => {
    const removeShoppingItem = vi.fn().mockResolvedValue(undefined)
    const executor = new PlannerActionExecutor()
    const deps = createDependencies({
      createShoppingItem: vi
        .fn()
        .mockResolvedValueOnce({ id: 'shopping-1' })
        .mockResolvedValueOnce({ id: 'shopping-2' }),
      removeShoppingItem,
    })
    const preview = await executor.prepareAction(
      createIntent({
        intent: 'add_shopping_item',
        items: [{ title: 'молоко' }, { title: 'хлеб' }],
      }),
      CONTEXT,
      deps,
    )
    const result = await executor.executeAction(preview.id, {}, CONTEXT, deps)

    const undoResult = await executor.undoAction(result, deps)

    expect(removeShoppingItem).toHaveBeenCalledTimes(2)
    expect(removeShoppingItem).toHaveBeenNthCalledWith(1, 'shopping-1')
    expect(removeShoppingItem).toHaveBeenNthCalledWith(2, 'shopping-2')
    expect(undoResult).toMatchObject({
      changedData: true,
      status: 'success',
      visualStatus: 'Добавление в покупки отменено.',
    })
  })

  it('requires unlock for agenda on the lock screen', async () => {
    const executor = new PlannerActionExecutor()
    const preview = await executor.prepareAction(
      createIntent({
        date: '2026-05-29',
        intent: 'get_agenda',
        requiresUnlock: true,
      }),
      { ...CONTEXT, isDeviceLocked: true },
      createDependencies(),
    )

    expect(preview).toMatchObject({
      canExecute: false,
      requiresUnlock: true,
      status: 'requires_unlock',
    })
  })

  it('returns agenda items when the device is unlocked', async () => {
    const executor = new PlannerActionExecutor()
    const deps = createDependencies({
      tasks: [
        createTaskRecord({
          id: 'task-1',
          plannedDate: '2026-05-29',
          plannedStartTime: '11:00',
          title: 'проверить оплату',
        }),
        createTaskRecord({
          id: 'task-2',
          plannedDate: '2026-05-29',
          plannedStartTime: '09:00',
          title: 'позвонить врачу',
        }),
      ],
    })

    const preview = await executor.prepareAction(
      createIntent({
        date: '2026-05-29',
        intent: 'get_agenda',
      }),
      CONTEXT,
      deps,
    )

    expect(preview.status).toBe('ready_for_confirmation')
    expect(preview.needsConfirmation).toBe(false)
    expect(preview.agendaItems?.map((item) => item.title)).toEqual([
      'позвонить врачу',
      'проверить оплату',
    ])
    expect(preview.summary).toContain('2 задачи')
  })

  it('uses stale cached agenda offline and blocks reschedule offline', async () => {
    const executor = new PlannerActionExecutor()
    const deps = createDependencies({
      isOnline: () => false,
      tasks: [
        createTaskRecord({
          id: 'task-1',
          plannedDate: '2026-05-29',
          title: 'позвонить врачу',
        }),
      ],
    })

    const agendaPreview = await executor.prepareAction(
      createIntent({
        date: '2026-05-29',
        intent: 'get_agenda',
      }),
      CONTEXT,
      deps,
    )
    const reschedulePreview = await executor.prepareAction(
      createIntent({
        date: '2026-05-30',
        intent: 'reschedule_task',
        targetQuery: 'позвонить врачу',
      }),
      CONTEXT,
      deps,
    )

    expect(agendaPreview).toMatchObject({
      isStale: true,
      status: 'ready_for_confirmation',
    })
    expect(reschedulePreview).toMatchObject({
      canExecute: false,
      isOffline: true,
      status: 'blocked',
    })
  })

  it('resolves reschedule candidates for not found, single and multiple matches', async () => {
    const executor = new PlannerActionExecutor()
    const deps = createDependencies({
      tasks: [
        createTaskRecord({
          id: 'task-1',
          title: 'Помыть окна на кухне',
          version: 2,
        }),
        createTaskRecord({
          id: 'task-2',
          title: 'Помыть окна в спальне',
          version: 3,
        }),
        createTaskRecord({
          id: 'task-3',
          title: 'Позвонить врачу',
          version: 4,
        }),
      ],
    })

    await expect(
      executor.prepareAction(
        createIntent({
          date: '2026-05-30',
          intent: 'reschedule_task',
          targetQuery: 'забрать заказ',
        }),
        CONTEXT,
        deps,
      ),
    ).resolves.toMatchObject({ status: 'not_found' })

    await expect(
      executor.prepareAction(
        createIntent({
          date: '2026-05-30',
          intent: 'reschedule_task',
          targetQuery: 'позвонить врачу',
        }),
        CONTEXT,
        deps,
      ),
    ).resolves.toMatchObject({
      canExecute: true,
      candidates: [expect.objectContaining({ taskId: 'task-3', version: 4 })],
      status: 'ready_for_confirmation',
    })

    const multipleCandidatesPreview = await executor.prepareAction(
      createIntent({
        date: '2026-05-30',
        intent: 'reschedule_task',
        targetQuery: 'помыть окна',
      }),
      CONTEXT,
      deps,
    )

    expect(multipleCandidatesPreview.status).toBe('multiple_candidates')
    expect(multipleCandidatesPreview.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: 'task-1' }),
        expect.objectContaining({ taskId: 'task-2' }),
      ]),
    )
  })

  it('executes and undoes reschedule with previous schedule and updated version', async () => {
    const executor = new PlannerActionExecutor()
    const task = createTaskRecord({
      id: 'task-1',
      plannedDate: '2026-05-29',
      plannedEndTime: '11:00',
      plannedStartTime: '10:00',
      title: 'Помыть окна',
      version: 1,
    })
    const deps = createDependencies({ tasks: [task] })
    const preview = await executor.prepareAction(
      createIntent({
        date: '2026-05-30',
        intent: 'reschedule_task',
        targetQuery: 'помыть окна',
        time: '12:00',
      }),
      CONTEXT,
      deps,
    )

    const result = await executor.executeAction(preview.id, {}, CONTEXT, deps)
    const undoResult = await executor.undoAction(result, deps)

    expect(result).toMatchObject({
      changedData: true,
      status: 'success',
      undo: {
        expectedVersion: 2,
        previousSchedule: {
          plannedDate: '2026-05-29',
          plannedEndTime: '11:00',
          plannedStartTime: '10:00',
        },
        type: 'reschedule_task',
        updatedTaskId: 'task-1',
      },
      updatedTaskId: 'task-1',
    })
    expect(deps.taskClient?.setTaskSchedule).toHaveBeenLastCalledWith(
      'task-1',
      {
        expectedVersion: 2,
        schedule: {
          plannedDate: '2026-05-29',
          plannedEndTime: '11:00',
          plannedStartTime: '10:00',
        },
      },
    )
    expect(undoResult).toMatchObject({
      changedData: true,
      status: 'success',
      visualStatus: 'Перенос отменен.',
    })
  })

  it('rejects stale reschedule versions before update', async () => {
    const executor = new PlannerActionExecutor()
    const task = createTaskRecord({
      id: 'task-1',
      title: 'Помыть окна',
      version: 1,
    })
    const deps = createDependencies({ tasks: [task] })
    const preview = await executor.prepareAction(
      createIntent({
        date: '2026-05-30',
        intent: 'reschedule_task',
        targetQuery: 'помыть окна',
      }),
      CONTEXT,
      deps,
    )

    task.version = 2

    const result = await executor.executeAction(preview.id, {}, CONTEXT, deps)

    expect(result).toMatchObject({
      errorCode: 'task_version_conflict',
      status: 'requires_refresh',
    })
    expect(deps.taskClient?.setTaskSchedule).not.toHaveBeenCalled()
  })

  it('blocks non-rollout roles and keeps test users on normal workspace permissions', async () => {
    const executor = new PlannerActionExecutor()

    for (const appRole of ['admin', 'user', 'guest'] satisfies AppRole[]) {
      await expect(
        executor.prepareAction(
          createIntent({ intent: 'create_task', title: 'проверить оплату' }),
          { ...CONTEXT, appRole },
          createDependencies(),
        ),
      ).resolves.toMatchObject({
        reason: 'voice_feature_forbidden',
        status: 'blocked',
      })
    }

    const deps = createDependencies({
      setTaskSchedule: vi
        .fn()
        .mockRejectedValue({ code: 'workspace_write_forbidden' }),
      tasks: [
        createTaskRecord({
          id: 'task-1',
          title: 'Помыть окна',
          version: 1,
        }),
      ],
    })
    const preview = await executor.prepareAction(
      createIntent({
        date: '2026-05-30',
        intent: 'reschedule_task',
        targetQuery: 'помыть окна',
      }),
      { ...CONTEXT, appRole: 'test' },
      deps,
    )
    const result = await executor.executeAction(
      preview.id,
      {},
      { ...CONTEXT, appRole: 'test' },
      deps,
    )

    expect(result).toMatchObject({
      errorCode: 'workspace_write_forbidden',
      status: 'failed',
    })
  })
})

function createIntent(overrides: Partial<PlannerIntent>): PlannerIntent {
  return {
    confidence: 0.9,
    intent: 'create_task',
    needsConfirmation: true,
    rawText: 'тестовая команда',
    title: 'проверить оплату',
    ...overrides,
  } as PlannerIntent
}

function createDependencies(
  overrides: {
    createShoppingItem?: PlannerActionExecutorDependencies['createShoppingItem']
    createTask?: PlannerActionExecutorDependencies['createTask']
    isOnline?: () => boolean
    removeShoppingItem?: PlannerActionExecutorDependencies['removeShoppingItem']
    removeTask?: PlannerActionExecutorDependencies['removeTask']
    setTaskSchedule?: NonNullable<
      PlannerActionExecutorDependencies['taskClient']
    >['setTaskSchedule']
    tasks?: TaskRecord[]
  } = {},
): PlannerActionExecutorDependencies {
  const tasks = overrides.tasks ?? []
  type SetTaskSchedule = NonNullable<
    PlannerActionExecutorDependencies['taskClient']
  >['setTaskSchedule']
  type ListTasks = NonNullable<
    PlannerActionExecutorDependencies['taskClient']
  >['listTasks']
  type CreateShoppingItem =
    PlannerActionExecutorDependencies['createShoppingItem']
  const setTaskSchedule =
    overrides.setTaskSchedule ??
    vi.fn((taskId: string, input: Parameters<SetTaskSchedule>[1]) => {
      const task = tasks.find((candidate) => candidate.id === taskId)

      if (!task) {
        throw Object.assign(new Error('Task not found.'), {
          code: 'task_not_found',
        })
      }

      task.plannedDate = input.schedule.plannedDate
      task.plannedStartTime = input.schedule.plannedStartTime
      task.plannedEndTime = input.schedule.plannedEndTime ?? null
      task.version += 1

      return Promise.resolve(task)
    })

  return {
    createShoppingItem:
      overrides.createShoppingItem ??
      vi.fn((input: Parameters<CreateShoppingItem>[0]) =>
        Promise.resolve({ id: `shopping-${input.text}` }),
      ),
    createTask:
      overrides.createTask ??
      vi.fn(() => Promise.resolve({ id: 'task-created' })),
    getCachedTasks: () => tasks,
    isOnline: overrides.isOnline ?? (() => true),
    refreshPlanner: vi.fn(() => Promise.resolve(undefined)),
    removeShoppingItem:
      overrides.removeShoppingItem ?? vi.fn(() => Promise.resolve(undefined)),
    removeTask: overrides.removeTask ?? vi.fn(() => Promise.resolve(true)),
    taskClient: {
      listTasks: vi.fn((filters: Parameters<ListTasks>[0]) =>
        Promise.resolve(
          filters?.plannedDate
            ? tasks.filter((task) => task.plannedDate === filters.plannedDate)
            : tasks,
        ),
      ),
      setTaskSchedule,
    },
  }
}

function createTaskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: 'User',
    authorUserId: 'user-1',
    completedAt: null,
    createdAt: '2026-05-28T09:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    icon: '',
    id: 'task-1',
    importance: 'not_important',
    linkedTask: null,
    note: '',
    plannedDate: '2026-05-29',
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    recurrence: null,
    requiresConfirmation: false,
    resource: null,
    routine: null,
    sourceWorkspace: null,
    sphereId: null,
    status: 'todo',
    title: 'Задача',
    updatedAt: '2026-05-28T09:00:00.000Z',
    urgency: 'not_urgent',
    version: 1,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}
