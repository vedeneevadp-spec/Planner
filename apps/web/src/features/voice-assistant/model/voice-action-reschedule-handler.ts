import {
  type PlannerIntent,
  type TaskRecord,
  type TaskScheduleInput,
  type VoiceActionCandidate,
  type VoiceActionConfirmedPayload,
  type VoiceActionContext,
  type VoiceActionPreview,
  type VoiceActionResult,
  type VoiceActionUndo,
  VoiceTextNormalizer,
} from '@planner/contracts'

import { sanitizeVoicePreviewForLockScreen } from './locked-screen-scrubber'
import type {
  PlannerActionExecutorDependencies,
  VoiceActionTaskClient,
} from './planner-action-executor'
import {
  createPreview,
  createResult,
  getErrorCode,
} from './voice-action-factory'
import { plural } from './voice-action-formatting'

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

export async function prepareRescheduleAction(
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
      reason: 'Не удалось загрузить свежий список задач. Перенос не выполнен.',
      status: 'blocked',
      summary: 'Не удалось загрузить свежий список задач. Перенос не выполнен.',
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
      summary: scheduleResolution.summary ?? 'На какое время перенести задачу?',
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

export async function executeRescheduleAction(
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

  const expectedVersion = confirmedPayload.expectedVersion ?? candidate.version

  if (expectedVersion !== candidate.version) {
    return createResult({
      errorCode: 'task_version_conflict',
      status: 'requires_refresh',
      visualStatus: 'Задача изменилась. Обнови список и попробуй снова.',
    })
  }

  let currentTask: TaskRecord | null = null

  try {
    currentTask = await findTaskById(dependencies.taskClient, candidate.taskId)
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

export async function undoRescheduleAction(
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

function isActivePlannerTaskStatus(status: string): boolean {
  return status !== 'done' && status !== 'archived'
}

function resolveRescheduleCandidates(
  tasks: TaskRecord[],
  targetQuery: string,
): VoiceActionCandidate[] {
  const scoredCandidates = tasks
    .filter(
      (task) =>
        isActivePlannerTaskStatus(task.status) && task.deletedAt === null,
    )
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

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}
