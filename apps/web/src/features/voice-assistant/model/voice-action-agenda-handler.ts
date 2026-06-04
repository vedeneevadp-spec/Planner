import type {
  PlannerIntent,
  VoiceActionAgendaItem,
  VoiceActionContext,
  VoiceActionPreview,
} from '@planner/contracts'

import { sanitizeVoicePreviewForLockScreen } from './locked-screen-scrubber'
import type {
  PlannerActionExecutorDependencies,
  VoiceActionCachedTask,
} from './planner-action-executor'
import { createPreview } from './voice-action-factory'
import { formatTaskCount } from './voice-action-formatting'

export async function prepareAgendaAction(
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
    .filter((task) => isActivePlannerTaskStatus(task.status))
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

function isActivePlannerTaskStatus(status: string): boolean {
  return status !== 'done' && status !== 'archived'
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
