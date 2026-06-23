import {
  addDateDays,
  getDateKeyInTimeZone,
  makeFixedZoneDateTime,
} from './time.service.js'
import type {
  DateOnlyValue,
  DateParseContext,
  FixedZoneDateTimeValue,
  FloatingLocalTimeValue,
  PlannerScheduleValue,
} from './time.types.js'

const DAILY_RECURRENCE_RULE = 'FREQ=DAILY'

export type ParsedRussianSchedule =
  | {
      kind: 'date_only'
      schedule: DateOnlyValue
      timeZone: string
    }
  | {
      kind: 'fixed_zone_datetime'
      schedule: FixedZoneDateTimeValue
      timeZone: string
      timeZoneInferred: boolean
    }
  | {
      kind: 'floating_local_time'
      schedule: FloatingLocalTimeValue
      timeZone: string
    }

export function parseDateOnlyValue(value: string): DateOnlyValue {
  return {
    kind: 'date_only',
    localDate: value,
  }
}

export function parseRussianSchedulePhrase(
  phrase: string,
  context: DateParseContext,
): ParsedRussianSchedule | null {
  const normalizedPhrase = phrase.trim().toLocaleLowerCase(context.locale)
  const today = getDateKeyInTimeZone(
    context.referenceInstantUtc,
    context.plannerTimeZone,
  )

  if (/кажд(?:ый|ое|ую)\s+день/u.test(normalizedPhrase)) {
    return {
      kind: 'floating_local_time',
      schedule: {
        kind: 'floating_local_time',
        localTime: parseTimeFromRussianPhrase(normalizedPhrase) ?? '09:00',
        recurrenceRule: DAILY_RECURRENCE_RULE,
      },
      timeZone: context.plannerTimeZone,
    }
  }

  if (/через\s+час/u.test(normalizedPhrase)) {
    const reference = new Date(context.referenceInstantUtc)
    const shifted = new Date(reference.getTime() + 60 * 60_000)
    const localDate = getDateKeyInTimeZone(shifted, context.plannerTimeZone)
    const localTime = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      timeZone: context.plannerTimeZone,
    }).format(shifted)

    return buildFixed(localDate, localTime, context)
  }

  const localDate = /завтра/u.test(normalizedPhrase)
    ? addDateDays(today, 1)
    : today
  const localTime = parseTimeFromRussianPhrase(normalizedPhrase)

  if (!localTime) {
    return {
      kind: 'date_only',
      schedule: {
        kind: 'date_only',
        localDate,
      },
      timeZone: context.plannerTimeZone,
    }
  }

  return buildFixed(localDate, localTime, context)
}

export function scheduleFromLegacyFields(input: {
  plannedDate: string | null
  plannedStartTime: string | null
  recurrenceRule?: string | null
  timeZone?: string | null
}): PlannerScheduleValue | null {
  if (!input.plannedDate && !input.plannedStartTime) {
    return null
  }

  if (input.plannedDate && !input.plannedStartTime) {
    return {
      kind: 'date_only',
      localDate: input.plannedDate,
    }
  }

  if (input.plannedDate && input.plannedStartTime && input.timeZone) {
    return makeFixedZoneDateTime({
      localDate: input.plannedDate,
      localTime: input.plannedStartTime,
      timeZone: input.timeZone,
    })
  }

  if (input.plannedStartTime) {
    return {
      kind: 'floating_local_time',
      localTime: input.plannedStartTime,
      ...(input.recurrenceRule ? { recurrenceRule: input.recurrenceRule } : {}),
    }
  }

  return null
}

function buildFixed(
  localDate: string,
  localTime: string,
  context: DateParseContext,
): ParsedRussianSchedule {
  return {
    kind: 'fixed_zone_datetime',
    schedule: makeFixedZoneDateTime({
      localDate,
      localTime,
      timeZone: context.plannerTimeZone,
    }),
    timeZone: context.plannerTimeZone,
    timeZoneInferred: true,
  }
}

function parseTimeFromRussianPhrase(phrase: string): string | null {
  if (/(?:^|\s)вечером(?=$|\s|[,.!?])/u.test(phrase)) {
    return '19:00'
  }

  if (/(?:^|\s)утром(?=$|\s|[,.!?])/u.test(phrase)) {
    return '09:00'
  }

  const explicitTimeMatch =
    /(?:^|\s)в\s+(\d{1,2})(?::(\d{2}))?(?=$|\s|[,.!?])/u.exec(phrase)

  if (!explicitTimeMatch) {
    return null
  }

  const hours = Number(explicitTimeMatch[1])
  const minutes = Number(explicitTimeMatch[2] ?? '0')

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}
