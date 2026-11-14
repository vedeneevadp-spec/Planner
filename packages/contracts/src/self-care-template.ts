import type {
  SelfCareItemInput,
  SelfCareTemplate,
  SelfCareTimeOfDay,
} from './self-care.js'
import { getTodayDate, makeFixedZoneDateTime } from './time/index.js'

type SelfCareItemInputOverrides = {
  [K in keyof SelfCareItemInput]?: SelfCareItemInput[K] | undefined
}

export function buildSelfCareItemInputFromTemplate(
  templateRecord: SelfCareTemplate,
  overrides: SelfCareItemInputOverrides = {},
  options: { plannerTimeZone?: string | undefined } = {},
): SelfCareItemInput {
  const plannerTimeZone = options.plannerTimeZone ?? 'UTC'
  const schedule = isRecord(templateRecord.defaultSchedule)
    ? templateRecord.defaultSchedule
    : {}
  const templateType =
    templateRecord.type === 'procedure' || templateRecord.type === 'medical'
      ? 'appointment'
      : templateRecord.type
  const scheduleDate =
    typeof schedule.startDate === 'string'
      ? schedule.startDate
      : getTodayDate(plannerTimeZone)
  const scheduleTime =
    typeof schedule.preferredTime === 'string'
      ? schedule.preferredTime
      : '09:00'
  const scheduleTimeZone =
    typeof schedule.timezone === 'string' && schedule.timezone.trim()
      ? schedule.timezone.trim()
      : plannerTimeZone
  const appointmentStartsAt = makeFixedZoneDateTime({
    localDate: scheduleDate,
    localTime: scheduleTime,
    timeZone: scheduleTimeZone,
  }).instantUtc
  const base: SelfCareItemInput = {
    alternatives: [],
    category: templateRecord.category,
    color: templateRecord.color,
    customCategoryId: null,
    defaultDurationMinutes: null,
    description: templateRecord.description,
    icon: templateRecord.icon,
    importance: templateRecord.importance,
    isActive: true,
    isArchived: false,
    isPrivate: true,
    migratedFromHabitId: null,
    preferredTimeOfDay: inferPreferredTimeOfDay(schedule.preferredTime),
    scheduleRule: {
      allowMultiplePerDay: false,
      dayOfMonth: null,
      daysOfWeek: [],
      endDate: null,
      flexiblePeriod: null,
      flexibleTargetCount: null,
      generateInCalendar: false,
      generateInTaskList: true,
      intervalUnit: null,
      intervalValue: null,
      monthOfYear: null,
      preferredTime: null,
      reminderOffsetsMinutes: [],
      repeatKind: 'none',
      startDate: getTodayDate(plannerTimeZone),
      timezone: null,
      weekOfMonth: null,
      ...schedule,
    },
    steps: templateRecord.defaultSteps.map((title, index) => ({
      defaultChecked: false,
      isOptional: false,
      order: index,
      title,
    })),
    title: templateRecord.title,
    type: templateType,
    ...(templateType === 'appointment'
      ? {
          appointmentDetails: {
            currency: null,
            endsAt: null,
            place: null,
            preparationNote: '',
            price: null,
            resultNote: null,
            specialistContact: null,
            specialistName: null,
            startsAt: appointmentStartsAt,
          },
        }
      : {}),
    ...(templateType === 'course'
      ? {
          courseDetails: {
            breakDays: 0,
            completedCount: 0,
            courseType: 'days',
            endDate: null,
            isCompleted: false,
            isPaused: false,
            repeatAfterCompletion: false,
            startDate: getTodayDate(plannerTimeZone),
            totalCount: 30,
          },
        }
      : {}),
  }

  const definedOverrides = compactOverrides(overrides)
  const merged = {
    ...base,
    ...definedOverrides,
  } as SelfCareItemInput

  return {
    ...merged,
    alternatives: definedOverrides.alternatives ?? base.alternatives,
    scheduleRule: definedOverrides.scheduleRule ?? base.scheduleRule,
    steps: definedOverrides.steps ?? base.steps,
  }
}

function inferPreferredTimeOfDay(time: unknown): SelfCareTimeOfDay {
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) {
    return 'anytime'
  }

  const hour = Number(time.slice(0, 2))
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  if (hour < 23) return 'evening'
  return 'night'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compactOverrides(
  overrides: SelfCareItemInputOverrides,
): SelfCareItemInputOverrides {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      result[key] = value
    }
  }

  return result
}
