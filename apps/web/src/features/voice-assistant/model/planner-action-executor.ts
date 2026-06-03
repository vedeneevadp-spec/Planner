import {
  canUseVoiceAssistant,
  type ChaosInboxItemRecord,
  type ChaosInboxItemUpdateInput,
  generateUuidV7,
  type NewTaskInput,
  type PlannerIntent,
  type TaskRecord,
  type TaskScheduleInput,
  validatePlannerIntent,
  type VoiceActionAgendaItem,
  type VoiceActionCandidate,
  type VoiceActionConfirmedPayload,
  type VoiceActionContext,
  type VoiceActionPreview,
  voiceActionPreviewSchema,
  type VoiceActionResult,
  voiceActionResultSchema,
  type VoiceActionShoppingItem,
  type VoiceActionUndo,
  VoiceTextNormalizer,
} from '@planner/contracts'

import {
  findShoppingListItemByText,
  formatShoppingListText,
  isActiveShoppingListTextItem,
} from '@/features/shopping-list'

import { sanitizeVoicePreviewForLockScreen } from './locked-screen-scrubber'
import {
  buildTaskInputFromPlannerIntent,
  getPlannerIntentTitle,
  getShoppingItemText,
} from './planner-intent-execution'

export interface VoiceActionCachedTask {
  id: string
  plannedEndTime?: string | null | undefined
  plannedDate: string | null
  plannedStartTime: string | null
  status: string
  title: string
}

export interface VoiceActionTaskClient {
  listTasks: (filters?: {
    limit?: number | undefined
    plannedDate?: string | undefined
  }) => Promise<TaskRecord[]>
  setTaskSchedule: (
    taskId: string,
    input: {
      expectedVersion: number
      schedule: TaskScheduleInput
    },
  ) => Promise<TaskRecord>
}

export interface VoiceActionShoppingItemInput {
  isFavorite?: boolean
  priority?: 'high' | 'low' | 'medium' | null
  shoppingCategory?: 'other'
  text: string
}

export interface PlannerActionExecutorDependencies {
  createShoppingItem: (input: VoiceActionShoppingItemInput) => Promise<unknown>
  createTask: (input: NewTaskInput) => Promise<unknown>
  getCachedTasks?: (() => VoiceActionCachedTask[]) | undefined
  isOnline?: (() => boolean) | undefined
  listShoppingItems?:
    | (() => Promise<ChaosInboxItemRecord[]> | ChaosInboxItemRecord[])
    | undefined
  refreshPlanner?: (() => Promise<void>) | undefined
  removeShoppingItem?: ((itemId: string) => Promise<unknown>) | undefined
  removeTask?: ((taskId: string) => Promise<unknown>) | undefined
  taskClient?: VoiceActionTaskClient | null | undefined
  updateShoppingItem?:
    | ((itemId: string, patch: ChaosInboxItemUpdateInput) => Promise<unknown>)
    | undefined
}

interface StoredPreview {
  context: VoiceActionContext
  preview: VoiceActionPreview
}

interface RescheduleScheduleSource {
  plannedDate: string | null
  plannedEndTime?: string | null | undefined
  plannedStartTime: string | null
}

interface RescheduleScheduleResolution {
  errorCode?: string | undefined
  schedule?: TaskScheduleInput | undefined
  summary?: string | undefined
}

const UNSUPPORTED_MESSAGE =
  'Пока я умею создавать задачи, добавлять покупки, показывать список покупок, переносить задачи и показывать план на сегодня или завтра.'

export class PlannerActionExecutor {
  private readonly previews = new Map<string, StoredPreview>()

  async prepareAction(
    intentInput: PlannerIntent,
    context: VoiceActionContext,
    dependencies: PlannerActionExecutorDependencies,
  ): Promise<VoiceActionPreview> {
    const intent = validatePlannerIntent(intentInput)

    if (!canUseVoiceAssistant(context.appRole)) {
      return this.savePreview(
        createPreview(intent, {
          canExecute: false,
          context,
          reason: 'voice_feature_forbidden',
          status: 'blocked',
          summary: 'Голосовые действия доступны только owner и test.',
          title: 'Голосовое действие недоступно',
        }),
        context,
      )
    }

    switch (intent.intent) {
      case 'create_task':
        return this.savePreview(
          createPreview(intent, {
            canExecute: true,
            context,
            needsConfirmation: true,
            summary: buildCreateTaskSummary(intent),
            title: 'Создать задачу',
          }),
          context,
        )

      case 'add_shopping_item':
        return this.savePreview(
          createPreview(intent, {
            canExecute: true,
            context,
            needsConfirmation: true,
            summary: `Добавить в покупки: ${formatShoppingItems(intent)}.`,
            title: 'Добавить в покупки',
          }),
          context,
        )

      case 'get_shopping_list':
        return this.savePreview(
          await this.prepareShoppingListAction(intent, context, dependencies),
          context,
        )

      case 'get_agenda':
        return this.savePreview(
          await this.prepareAgendaAction(intent, context, dependencies),
          context,
        )

      case 'reschedule_task':
        return this.savePreview(
          await this.prepareRescheduleAction(intent, context, dependencies),
          context,
        )

      case 'clarify':
        return this.savePreview(
          createPreview(intent, {
            canExecute: false,
            context,
            needsConfirmation: false,
            status: 'requires_clarification',
            summary: intent.clarificationQuestion ?? 'Нужно уточнить команду.',
            title: 'Нужно уточнение',
          }),
          context,
        )

      case 'unsupported':
        return this.savePreview(
          createPreview(intent, {
            canExecute: false,
            context,
            needsConfirmation: false,
            status: 'unsupported',
            summary: intent.clarificationQuestion ?? UNSUPPORTED_MESSAGE,
            title: 'Команда не поддерживается',
          }),
          context,
        )
    }
  }

  async executeAction(
    previewId: string,
    confirmedPayload: VoiceActionConfirmedPayload = {},
    context: VoiceActionContext | undefined,
    dependencies: PlannerActionExecutorDependencies,
  ): Promise<VoiceActionResult> {
    const storedPreview = this.previews.get(previewId)

    if (!storedPreview) {
      return createResult({
        errorCode: 'voice_action_preview_not_found',
        status: 'failed',
        visualStatus: 'Действие устарело. Повтори команду.',
      })
    }

    const preview = storedPreview.preview
    const runtimeContext = context ?? storedPreview.context

    if (!canUseVoiceAssistant(runtimeContext.appRole)) {
      return createResult({
        errorCode: 'voice_feature_forbidden',
        status: 'failed',
        visualStatus: 'Голосовые действия недоступны для этой роли.',
      })
    }

    if (
      preview.requiresUnlock &&
      (runtimeContext.isDeviceLocked || storedPreview.context.isDeviceLocked)
    ) {
      return createResult({
        errorCode: 'requires_unlock',
        status: 'failed',
        visualStatus: 'Разблокируй устройство и попробуй снова.',
      })
    }

    if (preview.isDangerous && confirmedPayload.confirmed !== true) {
      return createResult({
        errorCode: 'dangerous_intent_confirmation_required',
        status: 'failed',
        visualStatus: 'Подтверди опасное действие перед выполнением.',
      })
    }

    if (preview.status !== 'ready_for_confirmation') {
      if (
        preview.status === 'multiple_candidates' &&
        preview.type === 'reschedule_task'
      ) {
        return this.executeRescheduleAction(
          preview,
          confirmedPayload,
          dependencies,
        )
      }

      return createResult({
        errorCode: preview.status,
        status: 'failed',
        visualStatus: preview.reason ?? preview.summary,
      })
    }

    switch (preview.type) {
      case 'create_task':
        return this.executeCreateTaskAction(preview, dependencies)
      case 'add_shopping_item':
        return this.executeShoppingAction(preview, dependencies)
      case 'get_shopping_list':
        return createResult({
          status: 'success',
          visualStatus: preview.summary,
        })
      case 'reschedule_task':
        return this.executeRescheduleAction(
          preview,
          confirmedPayload,
          dependencies,
        )
      case 'get_agenda':
        return createResult({
          status: 'success',
          visualStatus: preview.summary,
        })
      case 'clarify':
      case 'unsupported':
        return createResult({
          errorCode: preview.status,
          status: 'failed',
          visualStatus: preview.summary,
        })
    }
  }

  async undoAction(
    result: VoiceActionResult,
    dependencies: PlannerActionExecutorDependencies,
  ): Promise<VoiceActionResult> {
    if (result.status !== 'success' || !result.undo) {
      return createResult({
        errorCode: 'voice_action_undo_unavailable',
        status: 'failed',
        visualStatus: 'Для этого действия отмена недоступна.',
      })
    }

    switch (result.undo.type) {
      case 'create_task':
        return this.undoCreateTaskAction(result.undo, dependencies)
      case 'add_shopping_item':
        return this.undoShoppingAction(result.undo, dependencies)
      case 'reschedule_task':
        return this.undoRescheduleAction(result.undo, dependencies)
    }
  }

  private async prepareAgendaAction(
    intent: PlannerIntent,
    context: VoiceActionContext,
    dependencies: PlannerActionExecutorDependencies,
  ): Promise<VoiceActionPreview> {
    if (context.isDeviceLocked || intent.requiresUnlock) {
      return sanitizeVoicePreviewForLockScreen(
        createPreview(intent, {
          canExecute: false,
          context,
          needsConfirmation: false,
          reason: 'requires_unlock',
          requiresUnlock: true,
          status: 'requires_unlock',
          summary: 'Разблокируй устройство, чтобы посмотреть план.',
          title: 'Нужна разблокировка',
        }),
      )
    }

    const agendaResult = await loadAgendaTasks(intent, dependencies)

    if (!agendaResult.ok) {
      return createPreview(intent, {
        canExecute: false,
        context,
        isOffline: true,
        needsConfirmation: false,
        reason: agendaResult.reason,
        status: 'blocked',
        summary: agendaResult.reason,
        title: 'План недоступен',
      })
    }

    const agendaItems = agendaResult.tasks
      .filter((task) => task.status !== 'done')
      .sort(compareAgendaTasks)
      .map(toAgendaItem)
    const summary = buildAgendaSummary(intent.date!, agendaItems, {
      isStale: agendaResult.isStale,
    })

    return createPreview(intent, {
      agendaItems,
      canExecute: false,
      context,
      isOffline: agendaResult.isStale,
      isStale: agendaResult.isStale,
      needsConfirmation: false,
      summary,
      title: `План на ${intent.date}`,
    })
  }

  private async prepareShoppingListAction(
    intent: PlannerIntent,
    context: VoiceActionContext,
    dependencies: PlannerActionExecutorDependencies,
  ): Promise<VoiceActionPreview> {
    if (context.isDeviceLocked || intent.requiresUnlock) {
      return sanitizeVoicePreviewForLockScreen(
        createPreview(intent, {
          canExecute: false,
          context,
          needsConfirmation: false,
          reason: 'requires_unlock',
          requiresUnlock: true,
          status: 'requires_unlock',
          summary: 'Разблокируй устройство, чтобы посмотреть список покупок.',
          title: 'Нужна разблокировка',
        }),
      )
    }

    const shoppingListResult = await loadShoppingListItems(dependencies)

    if (!shoppingListResult.ok) {
      return createPreview(intent, {
        canExecute: false,
        context,
        isOffline: true,
        needsConfirmation: false,
        reason: shoppingListResult.reason,
        status: 'blocked',
        summary: shoppingListResult.reason,
        title: 'Список покупок недоступен',
      })
    }

    const shoppingItems = shoppingListResult.items
      .filter(isActiveShoppingRecord)
      .sort(compareShoppingRecords)
      .map(toVoiceActionShoppingItem)

    return createPreview(intent, {
      canExecute: false,
      context,
      needsConfirmation: false,
      shoppingItems,
      summary: buildShoppingListSummary(shoppingItems),
      title: 'Список покупок',
    })
  }

  private async prepareRescheduleAction(
    intent: PlannerIntent,
    context: VoiceActionContext,
    dependencies: PlannerActionExecutorDependencies,
  ): Promise<VoiceActionPreview> {
    if (context.isDeviceLocked || intent.requiresUnlock) {
      return sanitizeVoicePreviewForLockScreen(
        createPreview(intent, {
          canExecute: false,
          context,
          reason: 'requires_unlock',
          requiresUnlock: true,
          status: 'requires_unlock',
          summary: 'Разблокируй устройство, чтобы перенести задачу.',
          title: 'Нужна разблокировка',
        }),
      )
    }

    if (!intent.date && intent.timeShiftMinutes === undefined) {
      return createPreview(intent, {
        canExecute: false,
        context,
        needsConfirmation: false,
        status: 'requires_clarification',
        summary: 'На какую дату перенести задачу?',
        title: 'Нужно уточнение',
      })
    }

    if (!dependencies.taskClient || dependencies.isOnline?.() === false) {
      return createPreview(intent, {
        canExecute: false,
        context,
        isOffline: true,
        reason:
          'Нет надежной версии задачи. Перенос голосом offline пока недоступен.',
        status: 'blocked',
        summary:
          'Нет надежной версии задачи. Перенос голосом offline пока недоступен.',
        title: 'Перенос недоступен offline',
      })
    }

    let tasks: TaskRecord[]

    try {
      tasks = await dependencies.taskClient.listTasks()
    } catch {
      return createPreview(intent, {
        canExecute: false,
        context,
        isOffline: true,
        reason:
          'Не удалось загрузить свежий список задач. Перенос не выполнен.',
        status: 'blocked',
        summary:
          'Не удалось загрузить свежий список задач. Перенос не выполнен.',
        title: 'Перенос недоступен',
      })
    }

    const candidates = resolveRescheduleCandidates(tasks, intent.targetQuery!)

    if (candidates.length === 0) {
      return createPreview(intent, {
        canExecute: false,
        context,
        needsConfirmation: false,
        reason: 'task_not_found',
        status: 'not_found',
        summary: `Не нашла задачу «${intent.targetQuery}».`,
        title: 'Задача не найдена',
      })
    }

    if (candidates.length > 1) {
      return createPreview(intent, {
        candidates,
        canExecute: false,
        context,
        status: 'multiple_candidates',
        summary: 'Нашла несколько похожих задач. Выбери, какую перенести.',
        title: 'Какую задачу перенести?',
      })
    }

    const candidate = candidates[0]!
    const scheduleResolution = resolveRescheduleSchedule(intent, candidate)

    if (!scheduleResolution.schedule) {
      return createPreview(intent, {
        canExecute: false,
        context,
        needsConfirmation: false,
        reason: scheduleResolution.errorCode,
        status: 'requires_clarification',
        summary:
          scheduleResolution.summary ?? 'На какое время перенести задачу?',
        title: 'Нужно уточнение',
      })
    }

    return createPreview(intent, {
      candidates,
      canExecute: true,
      context,
      summary: buildRescheduleSummary(candidate, intent),
      title: 'Перенести задачу',
    })
  }

  private async executeCreateTaskAction(
    preview: VoiceActionPreview,
    dependencies: PlannerActionExecutorDependencies,
  ): Promise<VoiceActionResult> {
    const taskInput = {
      ...buildTaskInputFromPlannerIntent(preview.intent),
      id: generateUuidV7(),
    }

    try {
      const result = await dependencies.createTask(taskInput)

      if (result === false) {
        return createResult({
          errorCode: 'task_create_failed',
          status: 'failed',
          visualStatus: 'Не удалось сохранить задачу.',
        })
      }

      return createResult({
        changedData: true,
        createdTaskId: getRecordId(result) ?? taskInput.id,
        status: 'success',
        undo: {
          createdTaskId: getRecordId(result) ?? taskInput.id,
          type: 'create_task',
        },
        visualStatus: 'Готово, задача сохранена.',
      })
    } catch {
      return createResult({
        errorCode: 'task_create_failed',
        status: 'failed',
        visualStatus: 'Не удалось сохранить задачу.',
      })
    }
  }

  private async executeShoppingAction(
    preview: VoiceActionPreview,
    dependencies: PlannerActionExecutorDependencies,
  ): Promise<VoiceActionResult> {
    const createdShoppingItemIds: string[] = []
    const createdItemTitles: string[] = []
    const duplicateItemTitles: string[] = []
    const reactivatedItemTitles: string[] = []

    try {
      const shoppingItems = await loadShoppingItemsForMutation(dependencies)

      for (const item of preview.intent.items ?? []) {
        const itemText = formatShoppingListText(getShoppingItemText(item))
        const existingItem = findShoppingListItemByText(shoppingItems, itemText)

        if (existingItem && isActiveShoppingListTextItem(existingItem)) {
          duplicateItemTitles.push(formatShoppingListText(existingItem.text))
          continue
        }

        if (existingItem) {
          if (!dependencies.updateShoppingItem) {
            return createResult({
              errorCode: 'shopping_update_unavailable',
              status: 'failed',
              visualStatus: 'Не удалось вернуть покупку в список.',
            })
          }

          const updatedItem = await dependencies.updateShoppingItem(
            existingItem.id,
            { status: 'new' },
          )
          const updatedRecord = isShoppingRecord(updatedItem)
            ? updatedItem
            : { ...existingItem, status: 'new' as const }

          replaceShoppingRecord(shoppingItems, updatedRecord)
          reactivatedItemTitles.push(formatShoppingListText(existingItem.text))
          continue
        }

        const createdItem = await dependencies.createShoppingItem({
          isFavorite: false,
          priority: null,
          shoppingCategory: 'other',
          text: itemText,
        })
        const itemId = getRecordId(createdItem)

        if (itemId) {
          createdShoppingItemIds.push(itemId)
        }

        createdItemTitles.push(itemText)

        if (isShoppingRecord(createdItem)) {
          shoppingItems.unshift(createdItem)
        }
      }

      const hasChangedData =
        createdItemTitles.length > 0 || reactivatedItemTitles.length > 0
      const canUndo =
        reactivatedItemTitles.length === 0 &&
        duplicateItemTitles.length === 0 &&
        createdShoppingItemIds.length > 0

      return createResult({
        changedData: hasChangedData || undefined,
        createdShoppingItemIds:
          createdShoppingItemIds.length > 0
            ? createdShoppingItemIds
            : undefined,
        status: 'success',
        undo: canUndo
          ? {
              createdShoppingItemIds,
              type: 'add_shopping_item',
            }
          : undefined,
        visualStatus: buildShoppingMutationStatus({
          createdItemTitles,
          duplicateItemTitles,
          reactivatedItemTitles,
        }),
      })
    } catch {
      return createResult({
        errorCode: 'shopping_create_failed',
        status: 'failed',
        visualStatus: 'Не удалось добавить в покупки.',
      })
    }
  }

  private async executeRescheduleAction(
    preview: VoiceActionPreview,
    confirmedPayload: VoiceActionConfirmedPayload,
    dependencies: PlannerActionExecutorDependencies,
  ): Promise<VoiceActionResult> {
    if (!dependencies.taskClient) {
      return createResult({
        errorCode: 'task_client_unavailable',
        status: 'failed',
        visualStatus: 'Перенос сейчас недоступен.',
      })
    }

    const candidate = resolveConfirmedCandidate(preview, confirmedPayload)

    if (!candidate) {
      return createResult({
        errorCode: 'candidate_required',
        status: 'failed',
        visualStatus: 'Выбери задачу для переноса.',
      })
    }

    const expectedVersion =
      confirmedPayload.expectedVersion ?? candidate.version

    if (expectedVersion !== candidate.version) {
      return createResult({
        errorCode: 'task_version_conflict',
        status: 'requires_refresh',
        visualStatus: 'Задача изменилась. Обнови список и попробуй снова.',
      })
    }

    let currentTask: TaskRecord | null = null

    try {
      currentTask = await findTaskById(
        dependencies.taskClient,
        candidate.taskId,
      )
    } catch {
      return createResult({
        errorCode: 'task_refresh_failed',
        status: 'failed',
        visualStatus: 'Не удалось проверить свежую версию задачи.',
      })
    }

    if (!currentTask) {
      return createResult({
        errorCode: 'task_not_found',
        status: 'failed',
        visualStatus: 'Задача больше не найдена.',
      })
    }

    if (currentTask.version !== expectedVersion) {
      return createResult({
        errorCode: 'task_version_conflict',
        status: 'requires_refresh',
        visualStatus: 'Задача изменилась. Обнови список и попробуй снова.',
      })
    }

    const scheduleResolution = resolveRescheduleSchedule(
      preview.intent,
      currentTask,
    )

    if (!scheduleResolution.schedule) {
      return createResult({
        errorCode: scheduleResolution.errorCode ?? 'reschedule_time_required',
        status: 'failed',
        visualStatus:
          scheduleResolution.summary ?? 'На какое время перенести задачу?',
      })
    }

    const previousSchedule: TaskScheduleInput = {
      plannedDate: currentTask.plannedDate,
      plannedEndTime: currentTask.plannedEndTime ?? null,
      plannedStartTime: currentTask.plannedStartTime,
    }

    try {
      const updatedTask = await dependencies.taskClient.setTaskSchedule(
        candidate.taskId,
        {
          expectedVersion,
          schedule: scheduleResolution.schedule,
        },
      )

      await dependencies.refreshPlanner?.()

      return createResult({
        changedData: true,
        status: 'success',
        updatedTaskId: updatedTask.id,
        undo: {
          expectedVersion: updatedTask.version,
          previousSchedule,
          type: 'reschedule_task',
          updatedTaskId: updatedTask.id,
        },
        visualStatus: 'Готово, задача перенесена.',
      })
    } catch (error) {
      if (getErrorCode(error) === 'task_version_conflict') {
        return createResult({
          errorCode: 'task_version_conflict',
          status: 'requires_refresh',
          visualStatus: 'Задача изменилась. Обнови список и попробуй снова.',
        })
      }

      return createResult({
        errorCode: getErrorCode(error) ?? 'task_reschedule_failed',
        status: 'failed',
        visualStatus: 'Не удалось перенести задачу.',
      })
    }
  }

  private savePreview(
    preview: VoiceActionPreview,
    context: VoiceActionContext,
  ): VoiceActionPreview {
    this.previews.set(preview.id, {
      context,
      preview,
    })

    return preview
  }

  private async undoCreateTaskAction(
    undo: Extract<VoiceActionUndo, { type: 'create_task' }>,
    dependencies: PlannerActionExecutorDependencies,
  ): Promise<VoiceActionResult> {
    if (!dependencies.removeTask) {
      return createResult({
        errorCode: 'voice_action_undo_unavailable',
        status: 'failed',
        visualStatus: 'Отмена создания задачи сейчас недоступна.',
      })
    }

    try {
      const result = await dependencies.removeTask(undo.createdTaskId)

      if (result === false) {
        return createResult({
          errorCode: 'task_undo_failed',
          status: 'failed',
          visualStatus: 'Не удалось отменить создание задачи.',
        })
      }

      await dependencies.refreshPlanner?.()

      return createResult({
        changedData: true,
        status: 'success',
        visualStatus: 'Создание задачи отменено.',
      })
    } catch {
      return createResult({
        errorCode: 'task_undo_failed',
        status: 'failed',
        visualStatus: 'Не удалось отменить создание задачи.',
      })
    }
  }

  private async undoShoppingAction(
    undo: Extract<VoiceActionUndo, { type: 'add_shopping_item' }>,
    dependencies: PlannerActionExecutorDependencies,
  ): Promise<VoiceActionResult> {
    if (!dependencies.removeShoppingItem) {
      return createResult({
        errorCode: 'voice_action_undo_unavailable',
        status: 'failed',
        visualStatus: 'Отмена покупок сейчас недоступна.',
      })
    }

    try {
      for (const itemId of undo.createdShoppingItemIds) {
        const result = await dependencies.removeShoppingItem(itemId)

        if (result === false) {
          return createResult({
            errorCode: 'shopping_undo_failed',
            status: 'failed',
            visualStatus: 'Не удалось отменить добавление в покупки.',
          })
        }
      }

      return createResult({
        changedData: true,
        status: 'success',
        visualStatus: 'Добавление в покупки отменено.',
      })
    } catch {
      return createResult({
        errorCode: 'shopping_undo_failed',
        status: 'failed',
        visualStatus: 'Не удалось отменить добавление в покупки.',
      })
    }
  }

  private async undoRescheduleAction(
    undo: Extract<VoiceActionUndo, { type: 'reschedule_task' }>,
    dependencies: PlannerActionExecutorDependencies,
  ): Promise<VoiceActionResult> {
    if (!dependencies.taskClient) {
      return createResult({
        errorCode: 'voice_action_undo_unavailable',
        status: 'failed',
        visualStatus: 'Отмена переноса сейчас недоступна.',
      })
    }

    if (dependencies.isOnline?.() === false) {
      return createResult({
        errorCode: 'voice_action_undo_offline',
        status: 'failed',
        visualStatus: 'Нужно подключение, чтобы отменить перенос.',
      })
    }

    try {
      const restoredTask = await dependencies.taskClient.setTaskSchedule(
        undo.updatedTaskId,
        {
          expectedVersion: undo.expectedVersion,
          schedule: undo.previousSchedule,
        },
      )

      await dependencies.refreshPlanner?.()

      return createResult({
        changedData: true,
        status: 'success',
        updatedTaskId: restoredTask.id,
        visualStatus: 'Перенос отменен.',
      })
    } catch (error) {
      return createResult({
        errorCode: getErrorCode(error) ?? 'reschedule_undo_failed',
        status: 'failed',
        visualStatus: 'Не удалось отменить перенос.',
      })
    }
  }
}

function createPreview(
  intent: PlannerIntent,
  input: {
    agendaItems?: VoiceActionAgendaItem[] | undefined
    candidates?: VoiceActionCandidate[] | undefined
    canExecute: boolean
    context: VoiceActionContext
    isOffline?: boolean | undefined
    isStale?: boolean | undefined
    needsConfirmation?: boolean | undefined
    reason?: string | undefined
    requiresUnlock?: boolean | undefined
    shoppingItems?: VoiceActionShoppingItem[] | undefined
    status?: VoiceActionPreview['status'] | undefined
    summary: string
    title: string
  },
): VoiceActionPreview {
  return voiceActionPreviewSchema.parse({
    agendaItems: input.agendaItems,
    candidates: input.candidates,
    canExecute: input.canExecute,
    id: generateUuidV7(),
    intent,
    isDangerous: intent.isDangerous ?? intent.intent === 'reschedule_task',
    isOffline: input.isOffline,
    isStale: input.isStale,
    needsConfirmation: input.needsConfirmation ?? true,
    reason: input.reason,
    requiresUnlock: input.requiresUnlock ?? false,
    shoppingItems: input.shoppingItems,
    status: input.status ?? 'ready_for_confirmation',
    summary: input.summary,
    title: input.title,
    type: intent.intent,
  })
}

function createResult(input: {
  changedData?: boolean | undefined
  createdShoppingItemIds?: string[] | undefined
  createdTaskId?: string | undefined
  errorCode?: string | undefined
  status: VoiceActionResult['status']
  undo?: VoiceActionUndo | undefined
  updatedTaskId?: string | undefined
  visualStatus: string
}): VoiceActionResult {
  return voiceActionResultSchema.parse(createDefinedObject(input))
}

function buildCreateTaskSummary(intent: PlannerIntent): string {
  const title = getPlannerIntentTitle(intent)
  const parts = [`Создать задачу «${title}»`]

  if (intent.reminderAt) {
    parts.push(`напоминание: ${intent.reminderAt}`)
  } else if (intent.date && intent.time) {
    parts.push(`${intent.date} в ${intent.time}`)
  } else if (intent.date) {
    parts.push(intent.date)
  }

  if (intent.priority === 'high') {
    parts.push('высокий приоритет')
  }

  return `${parts.join(', ')}.`
}

function formatShoppingItems(intent: PlannerIntent): string {
  return (intent.items ?? []).map(getShoppingItemText).join(', ')
}

async function loadAgendaTasks(
  intent: PlannerIntent,
  dependencies: PlannerActionExecutorDependencies,
): Promise<
  | { isStale: boolean; ok: true; tasks: VoiceActionCachedTask[] }
  | { ok: false; reason: string }
> {
  if (dependencies.taskClient && dependencies.isOnline?.() !== false) {
    try {
      const tasks = await dependencies.taskClient.listTasks({
        limit: 100,
        plannedDate: intent.date,
      })

      return { isStale: false, ok: true, tasks }
    } catch {
      // Fall through to cache if it exists.
    }
  }

  const cachedTasks = dependencies.getCachedTasks?.() ?? []
  const filteredTasks = cachedTasks.filter(
    (task) => task.plannedDate === intent.date,
  )

  if (filteredTasks.length > 0) {
    return { isStale: true, ok: true, tasks: filteredTasks }
  }

  return {
    ok: false,
    reason: 'Нет интернета, не могу загрузить задачи.',
  }
}

async function loadShoppingListItems(
  dependencies: PlannerActionExecutorDependencies,
): Promise<
  { items: ChaosInboxItemRecord[]; ok: true } | { ok: false; reason: string }
> {
  if (!dependencies.listShoppingItems) {
    return {
      ok: false,
      reason: 'Список покупок сейчас недоступен.',
    }
  }

  try {
    const items = await dependencies.listShoppingItems()

    return { items, ok: true }
  } catch {
    return {
      ok: false,
      reason: 'Не удалось загрузить список покупок.',
    }
  }
}

async function loadShoppingItemsForMutation(
  dependencies: PlannerActionExecutorDependencies,
): Promise<ChaosInboxItemRecord[]> {
  if (!dependencies.listShoppingItems) {
    return []
  }

  return [...(await dependencies.listShoppingItems())]
}

function compareAgendaTasks(
  left: VoiceActionCachedTask,
  right: VoiceActionCachedTask,
): number {
  const leftTime = left.plannedStartTime ?? '99:99'
  const rightTime = right.plannedStartTime ?? '99:99'

  if (leftTime !== rightTime) {
    return leftTime < rightTime ? -1 : 1
  }

  return left.title.localeCompare(right.title, 'ru')
}

function toAgendaItem(task: VoiceActionCachedTask): VoiceActionAgendaItem {
  return {
    plannedEndTime: task.plannedEndTime ?? null,
    plannedStartTime: task.plannedStartTime,
    status: task.status,
    taskId: task.id,
    title: task.title,
  }
}

function buildAgendaSummary(
  date: string,
  agendaItems: VoiceActionAgendaItem[],
  options: { isStale: boolean },
): string {
  const prefix = options.isStale ? 'Может быть неактуально. ' : ''

  if (agendaItems.length === 0) {
    return `${prefix}На ${date} нет активных задач.`
  }

  const nearestTasks = agendaItems
    .slice(0, 2)
    .map((item) => item.title)
    .join(' и ')

  return `${prefix}На ${date} ${formatTaskCount(agendaItems.length)}. Ближайшие: ${nearestTasks}.`
}

function isActiveShoppingRecord(item: ChaosInboxItemRecord): boolean {
  return (
    item.kind === 'shopping' &&
    item.deletedAt === null &&
    isActiveShoppingListTextItem(item)
  )
}

function compareShoppingRecords(
  left: ChaosInboxItemRecord,
  right: ChaosInboxItemRecord,
): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt.localeCompare(right.createdAt)
  }

  return left.text.localeCompare(right.text, 'ru')
}

function toVoiceActionShoppingItem(
  item: ChaosInboxItemRecord,
): VoiceActionShoppingItem {
  return {
    shoppingItemId: item.id,
    title: formatShoppingListText(item.text),
  }
}

function buildShoppingListSummary(
  shoppingItems: VoiceActionShoppingItem[],
): string {
  if (shoppingItems.length === 0) {
    return 'В списке покупок сейчас пусто.'
  }

  const visibleTitles = shoppingItems
    .slice(0, 5)
    .map((item) => item.title)
    .join(', ')
  const hiddenCount = shoppingItems.length - 5
  const hiddenSuffix =
    hiddenCount > 0
      ? ` и еще ${hiddenCount} ${plural(hiddenCount, 'позиция', 'позиции', 'позиций')}`
      : ''

  return `Нужно купить: ${visibleTitles}${hiddenSuffix}.`
}

function isShoppingRecord(value: unknown): value is ChaosInboxItemRecord {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { text?: unknown }).text === 'string' &&
    typeof (value as { status?: unknown }).status === 'string'
  )
}

function replaceShoppingRecord(
  items: ChaosInboxItemRecord[],
  nextItem: ChaosInboxItemRecord,
): void {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id)

  if (existingIndex === -1) {
    items.unshift(nextItem)
    return
  }

  items[existingIndex] = nextItem
}

function buildShoppingMutationStatus(input: {
  createdItemTitles: string[]
  duplicateItemTitles: string[]
  reactivatedItemTitles: string[]
}): string {
  const parts: string[] = []

  if (input.createdItemTitles.length > 0) {
    parts.push(`Добавлено: ${formatInlineList(input.createdItemTitles)}.`)
  }

  if (input.reactivatedItemTitles.length > 0) {
    parts.push(
      `Вернула в список: ${formatInlineList(input.reactivatedItemTitles)}.`,
    )
  }

  if (input.duplicateItemTitles.length > 0) {
    parts.push(`Уже есть: ${formatInlineList(input.duplicateItemTitles)}.`)
  }

  return parts.length > 0 ? parts.join(' ') : 'Такая покупка уже есть.'
}

function formatInlineList(items: string[]): string {
  return items.join(', ')
}

function formatTaskCount(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) {
    return `${count} задача`
  }

  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) {
    return `${count} задачи`
  }

  return `${count} задач`
}

function resolveRescheduleCandidates(
  tasks: TaskRecord[],
  targetQuery: string,
): VoiceActionCandidate[] {
  const scoredCandidates = tasks
    .filter((task) => task.status !== 'done' && task.deletedAt === null)
    .map((task) => ({
      candidate: toVoiceActionCandidate(task),
      score: scoreTaskCandidate(task.title, targetQuery),
    }))
    .filter((item) => item.score >= 0.55)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return compareCandidateSchedule(left.candidate, right.candidate)
    })

  return scoredCandidates.map((item) => item.candidate)
}

function toVoiceActionCandidate(task: TaskRecord): VoiceActionCandidate {
  return {
    isRecurring: Boolean(task.recurrence || task.routine),
    plannedDate: task.plannedDate,
    plannedEndTime: task.plannedEndTime,
    plannedStartTime: task.plannedStartTime,
    taskId: task.id,
    title: task.title,
    updatedAt: task.updatedAt,
    version: task.version,
  }
}

function scoreTaskCandidate(title: string, targetQuery: string): number {
  const normalizedTitle = normalizeSearchText(title)
  const normalizedQuery = normalizeSearchText(targetQuery)

  if (!normalizedTitle || !normalizedQuery) {
    return 0
  }

  if (normalizedTitle === normalizedQuery) {
    return 1
  }

  if (
    normalizedTitle.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedTitle)
  ) {
    return 0.9
  }

  const queryTokens = tokenizeSearchText(normalizedQuery)

  if (queryTokens.length === 0) {
    return 0
  }

  const titleTokens = new Set(tokenizeSearchText(normalizedTitle))
  const matchedTokens = queryTokens.filter((token) => titleTokens.has(token))

  return matchedTokens.length / queryTokens.length
}

function normalizeSearchText(text: string): string {
  return VoiceTextNormalizer.normalize(text)
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function tokenizeSearchText(text: string): string[] {
  return text.split(/\s+/gu).filter((token) => token.length > 2)
}

function compareCandidateSchedule(
  left: VoiceActionCandidate,
  right: VoiceActionCandidate,
): number {
  const leftDate = left.plannedDate ?? '9999-99-99'
  const rightDate = right.plannedDate ?? '9999-99-99'

  if (leftDate !== rightDate) {
    return leftDate < rightDate ? -1 : 1
  }

  const leftTime = left.plannedStartTime ?? '99:99'
  const rightTime = right.plannedStartTime ?? '99:99'

  if (leftTime !== rightTime) {
    return leftTime < rightTime ? -1 : 1
  }

  return left.title.localeCompare(right.title, 'ru')
}

function buildRescheduleSummary(
  candidate: VoiceActionCandidate,
  intent: PlannerIntent,
): string {
  const scheduleResolution = resolveRescheduleSchedule(intent, candidate)
  const recurringNote = candidate.isRecurring
    ? ' Изменится только выбранная задача.'
    : ''

  if (intent.timeShiftMinutes !== undefined) {
    const targetSchedule = scheduleResolution.schedule
      ? `: ${formatTaskSchedule(scheduleResolution.schedule)}`
      : ''

    return `Сдвинуть «${candidate.title}» ${formatTimeShift(intent)}${targetSchedule}.${recurringNote}`
  }

  const targetSchedule = scheduleResolution.schedule
    ? formatTaskSchedule(scheduleResolution.schedule)
    : 'новую дату'

  return `Перенести «${candidate.title}» на ${targetSchedule}.${recurringNote}`
}

function resolveConfirmedCandidate(
  preview: VoiceActionPreview,
  payload: VoiceActionConfirmedPayload,
): VoiceActionCandidate | null {
  const candidates = preview.candidates ?? []

  if (payload.candidateTaskId) {
    return (
      candidates.find(
        (candidate) => candidate.taskId === payload.candidateTaskId,
      ) ?? null
    )
  }

  return candidates.length === 1 ? candidates[0]! : null
}

async function findTaskById(
  taskClient: VoiceActionTaskClient,
  taskId: string,
): Promise<TaskRecord | null> {
  const tasks = await taskClient.listTasks()

  return tasks.find((task) => task.id === taskId) ?? null
}

function resolveRescheduleSchedule(
  intent: PlannerIntent,
  source: RescheduleScheduleSource,
): RescheduleScheduleResolution {
  if (intent.timeShiftMinutes !== undefined) {
    return resolveRelativeRescheduleSchedule(intent, source)
  }

  const plannedStartTime = intent.time ?? source.plannedStartTime

  return {
    schedule: {
      plannedDate: intent.date ?? source.plannedDate,
      plannedEndTime: intent.time ? null : (source.plannedEndTime ?? null),
      plannedStartTime: plannedStartTime ?? null,
    },
  }
}

function resolveRelativeRescheduleSchedule(
  intent: PlannerIntent,
  source: RescheduleScheduleSource,
): RescheduleScheduleResolution {
  const shiftMinutes = intent.timeShiftMinutes

  if (shiftMinutes === undefined) {
    return {
      errorCode: 'reschedule_shift_missing',
      summary: 'На какую дату перенести задачу?',
    }
  }

  if (!source.plannedDate || !source.plannedStartTime) {
    return {
      errorCode: 'reschedule_time_required',
      summary: 'У задачи нет времени. На какое время перенести?',
    }
  }

  const shiftedStart = shiftLocalDateTime(
    source.plannedDate,
    source.plannedStartTime,
    shiftMinutes,
  )

  if (!shiftedStart) {
    return {
      errorCode: 'reschedule_invalid_time',
      summary: 'Не удалось посчитать новое время задачи.',
    }
  }

  const shiftedEnd = source.plannedEndTime
    ? shiftLocalDateTime(
        source.plannedDate,
        source.plannedEndTime,
        shiftMinutes,
      )
    : null
  const plannedDate = intent.date ?? shiftedStart.date
  const plannedStartTime = intent.time ?? shiftedStart.time
  const plannedEndTime =
    !intent.time &&
    shiftedEnd &&
    shiftedEnd.date === plannedDate &&
    shiftedEnd.time > plannedStartTime
      ? shiftedEnd.time
      : null

  return {
    schedule: {
      plannedDate,
      plannedEndTime,
      plannedStartTime,
    },
  }
}

function shiftLocalDateTime(
  dateKey: string,
  time: string,
  shiftMinutes: number,
): { date: string; time: string } | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateKey)
  const timeMatch = /^(\d{2}):(\d{2})$/u.exec(time)

  if (
    !dateMatch?.[1] ||
    !dateMatch[2] ||
    !dateMatch[3] ||
    !timeMatch?.[1] ||
    !timeMatch[2]
  ) {
    return null
  }

  const timestamp = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  )

  if (Number.isNaN(timestamp)) {
    return null
  }

  const shifted = new Date(timestamp + shiftMinutes * 60_000)

  return {
    date: `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`,
    time: `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`,
  }
}

function formatTaskSchedule(schedule: TaskScheduleInput): string {
  const date = schedule.plannedDate ?? 'без даты'
  const time = schedule.plannedStartTime
    ? ` в ${schedule.plannedStartTime}`
    : ''

  return `${date}${time}`
}

function formatTimeShift(intent: PlannerIntent): string {
  if (intent.timeShiftText) {
    return intent.timeShiftText
  }

  const shiftMinutes = intent.timeShiftMinutes ?? 0
  const direction = shiftMinutes < 0 ? 'раньше' : 'позже'

  return `на ${formatShiftDuration(Math.abs(shiftMinutes))} ${direction}`
}

function formatShiftDuration(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60)

    return `${days} ${plural(days, 'день', 'дня', 'дней')}`
  }

  if (minutes % 60 === 0) {
    const hours = minutes / 60

    return `${hours} ${plural(hours, 'час', 'часа', 'часов')}`
  }

  return `${minutes} ${plural(minutes, 'минута', 'минуты', 'минут')}`
}

function plural(value: number, one: string, few: string, many: string): string {
  const lastTwo = value % 100
  const last = value % 10

  if (lastTwo >= 11 && lastTwo <= 14) {
    return many
  }

  if (last === 1) {
    return one
  }

  if (last >= 2 && last <= 4) {
    return few
  }

  return many
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function getRecordId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const id = (value as { id?: unknown }).id

  return typeof id === 'string' ? id : undefined
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  const code = (error as { code?: unknown }).code

  return typeof code === 'string' ? code : undefined
}

function createDefinedObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T
}
