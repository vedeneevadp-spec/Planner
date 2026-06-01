import {
  type AppRole,
  type ChaosInboxItemRecord,
  type PlannerIntent,
  type TaskRecord,
  type VoiceActionContext,
  voiceCommandCorpusV1,
  type VoiceTestCase,
} from '@planner/contracts'
import { describe, expect, it, vi } from 'vitest'

import { createSafeVoicePreviewTelemetryPayload } from './locked-screen-scrubber'
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

    const result = await executor.executeAction(
      preview.id,
      { confirmed: true },
      CONTEXT,
      deps,
    )

    expect(result).toMatchObject({
      changedData: true,
      createdShoppingItemIds: ['shopping-1', 'shopping-2'],
      status: 'success',
      undo: {
        createdShoppingItemIds: ['shopping-1', 'shopping-2'],
        type: 'add_shopping_item',
      },
      visualStatus: 'Добавлено: Молоко, Хлеб.',
    })
    expect(createShoppingItem).toHaveBeenCalledTimes(2)
    expect(createShoppingItem).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ text: 'Молоко' }),
    )
    expect(createShoppingItem).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ text: 'Хлеб' }),
    )
  })

  it('returns only active shopping list items for shopping list queries', async () => {
    const executor = new PlannerActionExecutor()
    const deps = createDependencies({
      shoppingItems: [
        createShoppingRecord({
          id: 'shopping-1',
          status: 'new',
          text: 'молоко',
        }),
        createShoppingRecord({
          id: 'shopping-2',
          status: 'archived',
          text: 'Хлеб',
        }),
      ],
    })

    const preview = await executor.prepareAction(
      createIntent({
        intent: 'get_shopping_list',
        needsConfirmation: false,
        rawText: 'что надо купить',
      }),
      CONTEXT,
      deps,
    )

    expect(preview).toMatchObject({
      canExecute: false,
      needsConfirmation: false,
      shoppingItems: [{ shoppingItemId: 'shopping-1', title: 'Молоко' }],
      status: 'ready_for_confirmation',
      summary: 'Нужно купить: Молоко.',
      title: 'Список покупок',
    })
  })

  it('does not duplicate active shopping items and reactivates completed ones', async () => {
    const createShoppingItem = vi.fn().mockResolvedValue({ id: 'shopping-3' })
    const updateShoppingItem = vi.fn((itemId: string) =>
      Promise.resolve(
        createShoppingRecord({
          id: itemId,
          status: 'new',
          text: 'Хлеб',
        }),
      ),
    )
    const executor = new PlannerActionExecutor()
    const deps = createDependencies({
      createShoppingItem,
      shoppingItems: [
        createShoppingRecord({
          id: 'shopping-1',
          status: 'new',
          text: 'Молоко',
        }),
        createShoppingRecord({
          id: 'shopping-2',
          status: 'archived',
          text: 'хлеб',
        }),
      ],
      updateShoppingItem,
    })
    const preview = await executor.prepareAction(
      createIntent({
        intent: 'add_shopping_item',
        items: [{ title: 'молоко' }, { title: 'хлеб' }, { title: 'сыр' }],
      }),
      CONTEXT,
      deps,
    )

    const result = await executor.executeAction(
      preview.id,
      { confirmed: true },
      CONTEXT,
      deps,
    )

    expect(createShoppingItem).toHaveBeenCalledTimes(1)
    expect(createShoppingItem).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Сыр' }),
    )
    expect(updateShoppingItem).toHaveBeenCalledWith('shopping-2', {
      status: 'new',
    })
    expect(result).toMatchObject({
      changedData: true,
      status: 'success',
      visualStatus: 'Добавлено: Сыр. Вернула в список: Хлеб. Уже есть: Молоко.',
    })
    expect(result.undo).toBeUndefined()
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
    const result = await executor.executeAction(
      preview.id,
      { confirmed: true },
      CONTEXT,
      deps,
    )

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
    const result = await executor.executeAction(
      preview.id,
      { confirmed: true },
      CONTEXT,
      deps,
    )

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
    expect(preview.summary).toBe('Разблокируй телефон, чтобы продолжить.')
    expect(preview.agendaItems).toBeUndefined()
    expect(preview.intent.rawText).toBe('')
  })

  it('scrubs reschedule candidates and task titles on the lock screen', async () => {
    const executor = new PlannerActionExecutor()
    const preview = await executor.prepareAction(
      createIntent({
        date: '2026-05-30',
        intent: 'reschedule_task',
        rawText: 'перенеси секретный договор на завтра',
        requiresUnlock: true,
        targetQuery: 'секретный договор',
      }),
      { ...CONTEXT, isDeviceLocked: true },
      createDependencies({
        tasks: [
          createTaskRecord({
            id: 'task-secret',
            title: 'Секретный договор',
          }),
        ],
      }),
    )

    expect(preview).toMatchObject({
      candidates: undefined,
      status: 'requires_unlock',
      summary: 'Разблокируй телефон, чтобы продолжить.',
    })
    expect(JSON.stringify(preview)).not.toMatch(/секрет/i)
  })

  it('builds locked-screen telemetry without private preview fields', async () => {
    const executor = new PlannerActionExecutor()
    const preview = await executor.prepareAction(
      createIntent({
        date: '2026-05-30',
        intent: 'reschedule_task',
        rawText: 'перенеси секретный договор на завтра',
        requiresUnlock: true,
        targetQuery: 'секретный договор',
      }),
      { ...CONTEXT, isDeviceLocked: true },
      createDependencies({
        tasks: [
          createTaskRecord({
            id: 'task-secret',
            title: 'Секретный договор',
          }),
        ],
      }),
    )

    const telemetry = createSafeVoicePreviewTelemetryPayload(preview)
    const serialized = JSON.stringify(telemetry)

    expect(telemetry).toMatchObject({
      canExecute: false,
      intentType: 'reschedule_task',
      previewStatus: 'requires_unlock',
      requiresUnlock: true,
    })
    expect(serialized).not.toMatch(/секрет/i)
    expect(serialized).not.toMatch(/rawText|targetQuery|candidates|title/)
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

    const result = await executor.executeAction(
      preview.id,
      { confirmed: true },
      CONTEXT,
      deps,
    )
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

  it('executes relative reschedule shifts against the selected task schedule', async () => {
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
        datePrecision: 'relative',
        intent: 'reschedule_task',
        targetQuery: 'помыть окна',
        timeShiftMinutes: -60,
        timeShiftText: 'на час раньше',
      }),
      CONTEXT,
      deps,
    )

    const result = await executor.executeAction(
      preview.id,
      { confirmed: true },
      CONTEXT,
      deps,
    )

    expect(preview).toMatchObject({
      canExecute: true,
      status: 'ready_for_confirmation',
      summary: 'Сдвинуть «Помыть окна» на час раньше: 2026-05-29 в 09:00.',
    })
    expect(result).toMatchObject({
      changedData: true,
      status: 'success',
      undo: {
        previousSchedule: {
          plannedDate: '2026-05-29',
          plannedEndTime: '11:00',
          plannedStartTime: '10:00',
        },
        type: 'reschedule_task',
      },
      updatedTaskId: 'task-1',
    })
    expect(deps.taskClient?.setTaskSchedule).toHaveBeenCalledWith('task-1', {
      expectedVersion: 1,
      schedule: {
        plannedDate: '2026-05-29',
        plannedEndTime: '10:00',
        plannedStartTime: '09:00',
      },
    })
  })

  it('moves relative reschedule shifts across date boundaries', async () => {
    const executor = new PlannerActionExecutor()
    const task = createTaskRecord({
      id: 'task-1',
      plannedDate: '2026-05-29',
      plannedStartTime: '00:30',
      title: 'Помыть окна',
      version: 1,
    })
    const deps = createDependencies({ tasks: [task] })
    const preview = await executor.prepareAction(
      createIntent({
        datePrecision: 'relative',
        intent: 'reschedule_task',
        targetQuery: 'помыть окна',
        timeShiftMinutes: -60,
      }),
      CONTEXT,
      deps,
    )

    await executor.executeAction(preview.id, { confirmed: true }, CONTEXT, deps)

    expect(deps.taskClient?.setTaskSchedule).toHaveBeenCalledWith('task-1', {
      expectedVersion: 1,
      schedule: {
        plannedDate: '2026-05-28',
        plannedEndTime: null,
        plannedStartTime: '23:30',
      },
    })
  })

  it('requires clarification for relative reschedule when the task has no time', async () => {
    const executor = new PlannerActionExecutor()
    const deps = createDependencies({
      tasks: [
        createTaskRecord({
          id: 'task-1',
          plannedDate: '2026-05-29',
          plannedStartTime: null,
          title: 'Помыть окна',
          version: 1,
        }),
      ],
    })

    const preview = await executor.prepareAction(
      createIntent({
        datePrecision: 'relative',
        intent: 'reschedule_task',
        targetQuery: 'помыть окна',
        timeShiftMinutes: -60,
      }),
      CONTEXT,
      deps,
    )

    expect(preview).toMatchObject({
      canExecute: false,
      reason: 'reschedule_time_required',
      status: 'requires_clarification',
      summary: 'У задачи нет времени. На какое время перенести?',
    })
    expect(deps.taskClient?.setTaskSchedule).not.toHaveBeenCalled()
  })

  it('does not execute dangerous intents without explicit confirmation', async () => {
    const executor = new PlannerActionExecutor()
    const deps = createDependencies({
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
      CONTEXT,
      deps,
    )

    const result = await executor.executeAction(preview.id, {}, CONTEXT, deps)

    expect(result).toMatchObject({
      errorCode: 'dangerous_intent_confirmation_required',
      status: 'failed',
    })
    expect(deps.taskClient?.setTaskSchedule).not.toHaveBeenCalled()
  })

  it('blocks reschedule undo offline instead of restoring without a fresh version', async () => {
    const executor = new PlannerActionExecutor()
    const task = createTaskRecord({
      id: 'task-1',
      plannedDate: '2026-05-29',
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
      }),
      CONTEXT,
      deps,
    )
    const result = await executor.executeAction(
      preview.id,
      { confirmed: true },
      CONTEXT,
      deps,
    )

    deps.isOnline = () => false

    const undoResult = await executor.undoAction(result, deps)

    expect(undoResult).toMatchObject({
      errorCode: 'voice_action_undo_offline',
      status: 'failed',
      visualStatus: 'Нужно подключение, чтобы отменить перенос.',
    })
    expect(deps.taskClient?.setTaskSchedule).toHaveBeenCalledTimes(1)
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

    const result = await executor.executeAction(
      preview.id,
      { confirmed: true },
      CONTEXT,
      deps,
    )

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
      { confirmed: true },
      { ...CONTEXT, appRole: 'test' },
      deps,
    )

    expect(result).toMatchObject({
      errorCode: 'workspace_write_forbidden',
      status: 'failed',
    })
  })

  it('prepares action previews from the shared voice corpus', async () => {
    const corpusCases = voiceCommandCorpusV1.filter(
      (
        testCase,
      ): testCase is VoiceTestCase & {
        expectedIntent: PlannerIntent
        expectedPreview: NonNullable<VoiceTestCase['expectedPreview']>
      } => Boolean(testCase.expectedIntent && testCase.expectedPreview),
    )

    expect(corpusCases.length).toBeGreaterThanOrEqual(120)

    for (const testCase of corpusCases) {
      const executor = new PlannerActionExecutor()
      const preview = await executor.prepareAction(
        testCase.expectedIntent,
        createCorpusContext(testCase),
        createCorpusDependencies(testCase),
      )

      expect(preview.status, testCase.id).toBe(testCase.expectedPreview.status)

      if (testCase.expectedPreview.canExecute !== undefined) {
        expect(preview.canExecute, testCase.id).toBe(
          testCase.expectedPreview.canExecute,
        )
      }

      if (testCase.expectedPreview.candidateCount !== undefined) {
        expect(preview.candidates?.length ?? 0, testCase.id).toBe(
          testCase.expectedPreview.candidateCount,
        )
      }
    }
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
    shoppingItems?: ChaosInboxItemRecord[]
    tasks?: TaskRecord[]
    updateShoppingItem?: PlannerActionExecutorDependencies['updateShoppingItem']
  } = {},
): PlannerActionExecutorDependencies {
  const tasks = overrides.tasks ?? []
  const shoppingItems = overrides.shoppingItems ?? []
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
    listShoppingItems: () => Promise.resolve(shoppingItems),
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
    updateShoppingItem:
      overrides.updateShoppingItem ??
      vi.fn(
        (
          itemId: string,
          patch: Parameters<
            NonNullable<PlannerActionExecutorDependencies['updateShoppingItem']>
          >[1],
        ) => {
          const item = shoppingItems.find(
            (candidate) => candidate.id === itemId,
          )

          if (!item) {
            throw Object.assign(new Error('Shopping item not found.'), {
              code: 'shopping_not_found',
            })
          }

          if (patch.status !== undefined) {
            item.status = patch.status
          }

          return Promise.resolve(item)
        },
      ),
  }
}

function createCorpusContext(testCase: VoiceTestCase): VoiceActionContext {
  return {
    appRole: testCase.context.appRole,
    isDeviceLocked: testCase.context.isDeviceLocked,
    now: testCase.context.now,
    source: testCase.source,
    timezone: testCase.context.timezone,
    userId: 'user-1',
    workspaceId: 'workspace-1',
  }
}

function createCorpusDependencies(
  testCase: VoiceTestCase & { expectedIntent: PlannerIntent },
): PlannerActionExecutorDependencies {
  if (testCase.expectedIntent.intent === 'get_agenda') {
    return createDependencies({
      tasks: [
        createTaskRecord({
          id: 'agenda-1',
          plannedDate: testCase.expectedIntent.date ?? '2026-06-01',
          plannedStartTime: '09:00',
          title: 'Позвонить врачу',
        }),
      ],
    })
  }

  if (testCase.expectedIntent.intent === 'get_shopping_list') {
    return createDependencies({
      shoppingItems: [
        createShoppingRecord({ id: 'shopping-1', text: 'Молоко' }),
      ],
    })
  }

  if (testCase.expectedIntent.intent !== 'reschedule_task') {
    return createDependencies()
  }

  const candidateCount = testCase.expectedPreview?.candidateCount ?? 1
  const targetQuery = testCase.expectedIntent.targetQuery ?? 'помыть окна'

  if (candidateCount === 0) {
    return createDependencies({
      tasks: [createTaskRecord({ id: 'task-other', title: 'Другая задача' })],
    })
  }

  if (candidateCount === 2) {
    return createDependencies({
      tasks: [
        createTaskRecord({
          id: 'task-1',
          title: `${capitalize(targetQuery)} на кухне`,
          version: 1,
        }),
        createTaskRecord({
          id: 'task-2',
          title: `${capitalize(targetQuery)} в спальне`,
          version: 2,
        }),
      ],
    })
  }

  return createDependencies({
    tasks: [
      createTaskRecord({
        id: 'task-1',
        plannedEndTime:
          testCase.expectedIntent.timeShiftMinutes === undefined
            ? null
            : '11:00',
        plannedStartTime:
          testCase.expectedIntent.timeShiftMinutes === undefined
            ? null
            : '10:00',
        title: capitalize(targetQuery),
        version: 1,
      }),
    ],
  })
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
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

function createShoppingRecord(
  overrides: Pick<ChaosInboxItemRecord, 'id' | 'text'> &
    Partial<ChaosInboxItemRecord>,
): ChaosInboxItemRecord {
  const { id, text, ...rest } = overrides

  return {
    convertedNoteId: null,
    convertedTaskId: null,
    createdAt: '2026-05-28T09:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    id,
    isFavorite: false,
    kind: 'shopping',
    linkedTaskDeleted: false,
    priority: null,
    shoppingCategory: 'other',
    source: 'manual',
    sphereId: null,
    status: 'new',
    text,
    updatedAt: '2026-05-28T09:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
    ...rest,
  }
}
