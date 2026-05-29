import {
  canUseVoiceAssistant,
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
  VoiceTextNormalizer,
} from '@planner/contracts'

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
  refreshPlanner?: (() => Promise<void>) | undefined
  taskClient?: VoiceActionTaskClient | null | undefined
}

interface StoredPreview {
  context: VoiceActionContext
  preview: VoiceActionPreview
}

const UNSUPPORTED_MESSAGE =
  'Пока я умею создавать задачи, добавлять покупки, переносить задачи и показывать план на сегодня или завтра.'

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

  private async prepareAgendaAction(
    intent: PlannerIntent,
    context: VoiceActionContext,
    dependencies: PlannerActionExecutorDependencies,
  ): Promise<VoiceActionPreview> {
    if (context.isDeviceLocked || intent.requiresUnlock) {
      return createPreview(intent, {
        canExecute: false,
        context,
        needsConfirmation: false,
        reason: 'requires_unlock',
        requiresUnlock: true,
        status: 'requires_unlock',
        summary: 'Разблокируй устройство, чтобы посмотреть план.',
        title: 'Нужна разблокировка',
      })
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

  private async prepareRescheduleAction(
    intent: PlannerIntent,
    context: VoiceActionContext,
    dependencies: PlannerActionExecutorDependencies,
  ): Promise<VoiceActionPreview> {
    if (context.isDeviceLocked || intent.requiresUnlock) {
      return createPreview(intent, {
        canExecute: false,
        context,
        reason: 'requires_unlock',
        requiresUnlock: true,
        status: 'requires_unlock',
        summary: 'Разблокируй устройство, чтобы перенести задачу.',
        title: 'Нужна разблокировка',
      })
    }

    if (!intent.date) {
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
    try {
      const result = await dependencies.createTask(
        buildTaskInputFromPlannerIntent(preview.intent),
      )

      if (result === false) {
        return createResult({
          errorCode: 'task_create_failed',
          status: 'failed',
          visualStatus: 'Не удалось сохранить задачу.',
        })
      }

      return createResult({
        changedData: true,
        createdTaskId: getRecordId(result),
        status: 'success',
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

    try {
      for (const item of preview.intent.items ?? []) {
        const createdItem = await dependencies.createShoppingItem({
          isFavorite: false,
          priority: null,
          shoppingCategory: 'other',
          text: getShoppingItemText(item),
        })
        const itemId = getRecordId(createdItem)

        if (itemId) {
          createdShoppingItemIds.push(itemId)
        }
      }

      return createResult({
        changedData: true,
        createdShoppingItemIds,
        status: 'success',
        visualStatus: 'Добавлено в покупки.',
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

    try {
      const updatedTask = await dependencies.taskClient.setTaskSchedule(
        candidate.taskId,
        {
          expectedVersion,
          schedule: buildRescheduleTaskSchedule(preview.intent, candidate),
        },
      )

      await dependencies.refreshPlanner?.()

      return createResult({
        changedData: true,
        status: 'success',
        updatedTaskId: updatedTask.id,
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
  const targetDate = intent.date
  const targetTime = intent.time ? ` в ${intent.time}` : ''
  const recurringNote = candidate.isRecurring
    ? ' Изменится только выбранная задача.'
    : ''

  return `Перенести «${candidate.title}» на ${targetDate}${targetTime}.${recurringNote}`
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

function buildRescheduleTaskSchedule(
  intent: PlannerIntent,
  candidate: VoiceActionCandidate,
): TaskScheduleInput {
  const plannedStartTime = intent.time ?? candidate.plannedStartTime

  return {
    plannedDate: intent.date ?? candidate.plannedDate,
    plannedEndTime: intent.time ? null : (candidate.plannedEndTime ?? null),
    plannedStartTime: plannedStartTime ?? null,
  }
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
