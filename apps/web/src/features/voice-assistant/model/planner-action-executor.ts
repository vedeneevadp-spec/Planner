import {
  canUseVoiceAssistant,
  type ChaosInboxItemRecord,
  type ChaosInboxItemUpdateInput,
  type NewTaskInput,
  type PlannerIntent,
  type TaskRecord,
  type TaskScheduleInput,
  validatePlannerIntent,
  type VoiceActionConfirmedPayload,
  type VoiceActionContext,
  type VoiceActionPreview,
  type VoiceActionResult,
} from '@planner/contracts'

import { prepareAgendaAction } from './voice-action-agenda-handler'
import {
  buildCreateTaskSummary,
  executeCreateTaskAction,
  undoCreateTaskAction,
} from './voice-action-create-task-handler'
import { createPreview, createResult } from './voice-action-factory'
import {
  executeRescheduleAction,
  prepareRescheduleAction,
  undoRescheduleAction,
} from './voice-action-reschedule-handler'
import {
  executeShoppingAction,
  formatShoppingItems,
  prepareShoppingListAction,
  undoShoppingAction,
} from './voice-action-shopping-handler'

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
          await prepareShoppingListAction(intent, context, dependencies),
          context,
        )

      case 'get_agenda':
        return this.savePreview(
          await prepareAgendaAction(intent, context, dependencies),
          context,
        )

      case 'reschedule_task':
        return this.savePreview(
          await prepareRescheduleAction(intent, context, dependencies),
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
        return executeRescheduleAction(preview, confirmedPayload, dependencies)
      }

      return createResult({
        errorCode: preview.status,
        status: 'failed',
        visualStatus: preview.reason ?? preview.summary,
      })
    }

    switch (preview.type) {
      case 'create_task':
        return executeCreateTaskAction(preview, dependencies)
      case 'add_shopping_item':
        return executeShoppingAction(preview, dependencies)
      case 'get_shopping_list':
        return createResult({
          status: 'success',
          visualStatus: preview.summary,
        })
      case 'reschedule_task':
        return executeRescheduleAction(preview, confirmedPayload, dependencies)
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
        return undoCreateTaskAction(result.undo, dependencies)
      case 'add_shopping_item':
        return undoShoppingAction(result.undo, dependencies)
      case 'reschedule_task':
        return undoRescheduleAction(result.undo, dependencies)
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
}
