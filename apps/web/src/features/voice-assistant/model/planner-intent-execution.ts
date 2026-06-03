import {
  generateUuidV7,
  type NewTaskInput,
  type PlannerIntent,
  type TaskReminderOffsetMinutes,
} from '@planner/contracts'

import { formatShoppingListText } from './shopping-list-text'

interface IntentSchedule {
  plannedDate: string | null
  plannedEndTime: string | null
  plannedStartTime: string | null
}

const AUTO_CONFIRM_MIN_CONFIDENCE = 0.85
const AUTO_CONFIRM_VISUAL_UNDO_READY: boolean = false

export function getPlannerIntentTitle(intent: PlannerIntent): string {
  return intent.title?.trim() || intent.rawText.trim()
}

export function getPlannerIntentActionLabel(intent: PlannerIntent): string {
  switch (intent.intent) {
    case 'create_task':
      return 'Создать задачу'
    case 'add_shopping_item':
      return 'Добавить покупку'
    case 'get_shopping_list':
      return 'Показать покупки'
    case 'reschedule_task':
      return 'Перенести'
    case 'get_agenda':
      return 'Показать план'
    case 'clarify':
      return 'Уточнить'
    case 'unsupported':
      return 'Не поддерживается'
  }
}

export function isExecutablePlannerIntent(intent: PlannerIntent): boolean {
  return (
    intent.intent === 'create_task' || intent.intent === 'add_shopping_item'
  )
}

export function shouldAutoConfirmPlannerIntent(intent: PlannerIntent): boolean {
  if (!AUTO_CONFIRM_VISUAL_UNDO_READY) {
    return false
  }

  if (
    intent.needsConfirmation ||
    intent.confidence < AUTO_CONFIRM_MIN_CONFIDENCE
  ) {
    return false
  }

  if (intent.intent === 'add_shopping_item') {
    return Boolean(intent.items?.length)
  }

  return (
    intent.intent === 'create_task' &&
    intent.datePrecision === 'relative' &&
    Boolean(intent.reminderAt)
  )
}

export function buildTaskInputFromPlannerIntent(
  intent: PlannerIntent,
): NewTaskInput {
  const schedule = getIntentSchedule(intent)
  const reminderOffsets = getReminderOffsets(intent, schedule)
  const priority = getTaskPriority(intent)

  return {
    assigneeUserId: null,
    dueDate: null,
    icon: intent.reminderAt ? 'bell' : '',
    importance: priority.importance,
    note: '',
    plannedDate: schedule.plannedDate,
    plannedEndTime: schedule.plannedEndTime,
    plannedStartTime: schedule.plannedStartTime,
    project: '',
    projectId: null,
    recurrence: buildTaskRecurrenceFromPlannerIntent(intent, schedule),
    remindBeforeStart: reminderOffsets.length > 0,
    reminderOffsets,
    reminderTimeZone:
      reminderOffsets.length > 0 ? resolveClientTimeZone() : undefined,
    requiresConfirmation: false,
    resource: priority.resource,
    routine: null,
    sphereId: intent.sphereId ?? null,
    title: getPlannerIntentTitle(intent),
    urgency: priority.urgency,
  }
}

export function getShoppingItemText(
  item: NonNullable<PlannerIntent['items']>[number],
): string {
  return item.quantity
    ? `${item.quantity} ${formatShoppingListText(item.title)}`
    : formatShoppingListText(item.title)
}

function getIntentSchedule(intent: PlannerIntent): IntentSchedule {
  if (intent.reminderAt) {
    const [date, time] = intent.reminderAt.split('T')

    return {
      plannedDate: date || null,
      plannedEndTime: null,
      plannedStartTime: time?.slice(0, 5) ?? null,
    }
  }

  if (!intent.date) {
    return {
      plannedDate: null,
      plannedEndTime: null,
      plannedStartTime: null,
    }
  }

  return {
    plannedDate: intent.date,
    plannedEndTime: null,
    plannedStartTime: intent.time ?? null,
  }
}

function getReminderOffsets(
  intent: PlannerIntent,
  schedule: IntentSchedule,
): TaskReminderOffsetMinutes[] {
  if (
    !intent.reminderAt ||
    !schedule.plannedDate ||
    !schedule.plannedStartTime
  ) {
    return []
  }

  return [15]
}

function getTaskPriority(
  intent: PlannerIntent,
): Pick<NewTaskInput, 'importance' | 'resource' | 'urgency'> {
  if (intent.priority === 'high') {
    return {
      importance: 'important',
      resource: 3,
      urgency: 'urgent',
    }
  }

  if (intent.priority === 'low') {
    return {
      importance: 'not_important',
      resource: 1,
      urgency: 'not_urgent',
    }
  }

  return {
    importance: 'not_important',
    resource: null,
    urgency: 'not_urgent',
  }
}

function buildTaskRecurrenceFromPlannerIntent(
  intent: PlannerIntent,
  schedule: IntentSchedule,
): NonNullable<NewTaskInput['recurrence']> | null {
  if (!intent.recurrence || !schedule.plannedDate) {
    return null
  }

  if (intent.recurrence.frequency === 'yearly') {
    return null
  }

  return {
    daysOfWeek:
      intent.recurrence.frequency === 'weekly'
        ? [1, 2, 3, 4, 5]
        : [1, 2, 3, 4, 5, 6, 7],
    endDate: intent.recurrence.until ?? null,
    frequency: intent.recurrence.frequency,
    interval: intent.recurrence.interval ?? 1,
    isActive: true,
    seriesId: generateUuidV7(),
    startDate: schedule.plannedDate,
  }
}

function resolveClientTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}
