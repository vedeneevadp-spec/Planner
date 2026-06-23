import {
  addDateDays,
  addDateMonthsClamped,
  getDateDistance,
  getIsoWeekday as getIsoWeekdayForDateOnly,
  getIsoWeekStartDate,
  type SelfCareCompletion,
  type SelfCareCompletionStatus,
  type SelfCareFlexibleGoalProgress,
  type SelfCareItem,
  type SelfCareScheduleRule,
} from '@planner/contracts'

const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

export function generateSelfCareOccurrenceDates(input: {
  completions: SelfCareCompletion[]
  from: string
  item: Pick<SelfCareItem, 'createdAt' | 'type'>
  rule: SelfCareScheduleRule
  to: string
}): string[] {
  const start = input.rule.startDate ?? input.item.createdAt.slice(0, 10)
  const boundedFrom = maxDateKey(input.from, start)
  const boundedTo = input.rule.endDate
    ? minDateKey(input.to, input.rule.endDate)
    : input.to

  if (boundedFrom > boundedTo) {
    return []
  }

  switch (input.rule.repeatKind) {
    case 'daily':
      return enumerateDateKeys(boundedFrom, boundedTo).filter((dateKey) =>
        isEveryNDays(start, dateKey, input.rule.intervalValue ?? 1),
      )
    case 'weekly':
      return enumerateDateKeys(boundedFrom, boundedTo).filter(
        (dateKey) =>
          input.rule.daysOfWeek.includes(getIsoWeekday(dateKey)) &&
          isEveryNWeeks(start, dateKey, input.rule.intervalValue ?? 1),
      )
    case 'monthly':
      return generateMonthlyDates(input.rule, boundedFrom, boundedTo, start)
    case 'yearly':
      return generateYearlyDates(input.rule, boundedFrom, boundedTo, start)
    case 'interval':
      return generateIntervalDates(input.rule, boundedFrom, boundedTo, start)
    case 'after_completion':
      return generateAfterCompletionDate(
        input.rule,
        input.completions,
        boundedFrom,
        boundedTo,
        start,
      )
    case 'course':
      return generateCourseDates(input.rule, boundedFrom, boundedTo, start)
    case 'none':
    case 'flexible_goal':
      return []
  }
}

export function getFlexibleGoalProgress(input: {
  completions: SelfCareCompletion[]
  itemId: string
  periodEnd: string
  periodStart: string
  targetCount: number
}): SelfCareFlexibleGoalProgress {
  const completedCount = input.completions.filter(
    (completion) =>
      completion.itemId === input.itemId &&
      isCompletionProgressStatus(completion.status) &&
      completion.completedAt.slice(0, 10) >= input.periodStart &&
      completion.completedAt.slice(0, 10) <= input.periodEnd,
  ).length

  return {
    completedCount,
    periodEnd: input.periodEnd,
    periodStart: input.periodStart,
    remainingCount: Math.max(0, input.targetCount - completedCount),
    targetCount: input.targetCount,
  }
}

export function getFlexibleGoalPeriod(
  dateKey: string,
  period: SelfCareScheduleRule['flexiblePeriod'],
): { periodEnd: string; periodStart: string } {
  if (period === 'day') {
    return { periodEnd: dateKey, periodStart: dateKey }
  }

  if (period === 'month') {
    return {
      periodEnd: getMonthEnd(dateKey),
      periodStart: `${dateKey.slice(0, 7)}-01`,
    }
  }

  const periodStart = getWeekStart(dateKey)

  return {
    periodEnd: addDays(periodStart, 6),
    periodStart,
  }
}

export function getDateKey(date: Date): string {
  return formatUtcDateKey(date)
}

function formatUtcDateKey(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function normalizeDaysOfWeek(days: number[]): number[] {
  const normalized = [...new Set(days)].filter((day) =>
    ISO_WEEKDAYS.includes(day),
  )
  return normalized.sort((left, right) => left - right)
}

export function addDays(dateKey: string, days: number): string {
  return addDateDays(dateKey, days)
}

export function buildDueAt(
  dateKey: string,
  preferredTime: string | null,
): string | null {
  if (!preferredTime) {
    return null
  }

  const match = preferredTime.match(/^(\d{2}:\d{2})(?::(\d{2}))?$/)
  if (!match) {
    return null
  }

  return `${dateKey}T${match[1]}:${match[2] ?? '00'}.000Z`
}

export function getIsoWeekday(dateKey: string): number {
  return getIsoWeekdayForDateOnly(dateKey)
}

export function isCompletionProgressStatus(
  status: SelfCareCompletionStatus,
): boolean {
  return (
    status === 'done' || status === 'partial' || status === 'alternative_done'
  )
}

function generateMonthlyDates(
  rule: SelfCareScheduleRule,
  from: string,
  to: string,
  start: string,
): string[] {
  const result: string[] = []
  let cursor = `${from.slice(0, 7)}-01`
  const finalMonth = `${to.slice(0, 7)}-01`

  while (cursor <= finalMonth) {
    if (isEveryNMonths(start, cursor, rule.intervalValue ?? 1)) {
      const date = getMonthlyCandidateDate(rule, cursor)

      if (date >= from && date <= to && date >= start) {
        result.push(date)
      }
    }

    cursor = addMonths(cursor, 1)
  }

  return result
}

function getMonthlyCandidateDate(
  rule: SelfCareScheduleRule,
  monthStart: string,
): string {
  if (rule.weekOfMonth) {
    return getNthWeekdayOfMonth(
      monthStart,
      rule.daysOfWeek[0] ?? getIsoWeekday(monthStart),
      rule.weekOfMonth,
    )
  }

  const day = rule.dayOfMonth ?? dayOfMonth(monthStart)
  const lastDay = daysInMonth(yearOf(monthStart), monthOf(monthStart))

  return dateFromParts(
    yearOf(monthStart),
    monthOf(monthStart),
    Math.min(day, lastDay),
  )
}

function generateYearlyDates(
  rule: SelfCareScheduleRule,
  from: string,
  to: string,
  start: string,
): string[] {
  const result: string[] = []
  const every = rule.intervalValue ?? 1

  for (let year = yearOf(from); year <= yearOf(to); year += 1) {
    if ((year - yearOf(start)) % every !== 0) {
      continue
    }

    const month = rule.monthOfYear ?? monthOf(start)
    const day = Math.min(
      rule.dayOfMonth ?? dayOfMonth(start),
      daysInMonth(year, month),
    )
    const date = dateFromParts(year, month, day)

    if (date >= from && date <= to && date >= start) {
      result.push(date)
    }
  }

  return result
}

function generateIntervalDates(
  rule: SelfCareScheduleRule,
  from: string,
  to: string,
  start: string,
): string[] {
  const result: string[] = []
  let cursor = start
  const unit = rule.intervalUnit ?? 'day'
  const value = rule.intervalValue ?? 1

  while (cursor < from) {
    cursor = addInterval(cursor, value, unit)
  }

  while (cursor <= to) {
    result.push(cursor)
    cursor = addInterval(cursor, value, unit)
  }

  return result
}

function generateAfterCompletionDate(
  rule: SelfCareScheduleRule,
  completions: SelfCareCompletion[],
  from: string,
  to: string,
  start: string,
): string[] {
  const lastCompletion = completions
    .filter((completion) => isCompletionProgressStatus(completion.status))
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))[0]
  const baseDate = lastCompletion?.completedAt.slice(0, 10) ?? start
  const nextDate = lastCompletion
    ? addInterval(
        baseDate,
        rule.intervalValue ?? 1,
        rule.intervalUnit ?? 'month',
      )
    : baseDate

  return nextDate >= from && nextDate <= to ? [nextDate] : []
}

function generateCourseDates(
  rule: SelfCareScheduleRule,
  from: string,
  to: string,
  start: string,
): string[] {
  if (rule.daysOfWeek.length > 0) {
    return enumerateDateKeys(from, to).filter(
      (dateKey) =>
        dateKey >= start && rule.daysOfWeek.includes(getIsoWeekday(dateKey)),
    )
  }

  if (rule.intervalValue && rule.intervalUnit) {
    return generateIntervalDates(rule, from, to, start)
  }

  return enumerateDateKeys(from, to).filter((dateKey) => dateKey >= start)
}

function getNthWeekdayOfMonth(
  monthStart: string,
  weekday: number,
  weekOfMonth: number,
): string {
  if (weekOfMonth === -1) {
    let cursor = getMonthEnd(monthStart)

    while (getIsoWeekday(cursor) !== weekday) {
      cursor = addDays(cursor, -1)
    }

    return cursor
  }

  let cursor = monthStart
  while (getIsoWeekday(cursor) !== weekday) {
    cursor = addDays(cursor, 1)
  }

  return addDays(cursor, (Math.max(1, weekOfMonth) - 1) * 7)
}

function enumerateDateKeys(from: string, to: string): string[] {
  const result: string[] = []
  let cursor = from

  while (cursor <= to) {
    result.push(cursor)
    cursor = addDays(cursor, 1)
  }

  return result
}

function addMonths(dateKey: string, months: number): string {
  return addDateMonthsClamped(dateKey, months)
}

export function addInterval(
  dateKey: string,
  value: number,
  unit: NonNullable<SelfCareScheduleRule['intervalUnit']>,
): string {
  if (unit === 'day') return addDays(dateKey, value)
  if (unit === 'week') return addDays(dateKey, value * 7)
  if (unit === 'month') return addMonths(dateKey, value)
  return addMonths(dateKey, value * 12)
}

function dateFromParts(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function getWeekStart(dateKey: string): string {
  return getIsoWeekStartDate(dateKey)
}

function getMonthEnd(dateKey: string): string {
  return dateFromParts(
    yearOf(dateKey),
    monthOf(dateKey),
    daysInMonth(yearOf(dateKey), monthOf(dateKey)),
  )
}

function daysBetween(start: string, end: string): number {
  return getDateDistance(start, end)
}

function isEveryNDays(start: string, dateKey: string, every: number): boolean {
  return daysBetween(start, dateKey) % every === 0
}

function isEveryNWeeks(start: string, dateKey: string, every: number): boolean {
  return (
    Math.floor(daysBetween(getWeekStart(start), getWeekStart(dateKey)) / 7) %
      every ===
    0
  )
}

function isEveryNMonths(
  start: string,
  monthStart: string,
  every: number,
): boolean {
  const diff =
    (yearOf(monthStart) - yearOf(start)) * 12 +
    (monthOf(monthStart) - monthOf(start))
  return diff % every === 0
}

function yearOf(dateKey: string): number {
  return Number(dateKey.slice(0, 4))
}

function monthOf(dateKey: string): number {
  return Number(dateKey.slice(5, 7))
}

function dayOfMonth(dateKey: string): number {
  return Number(dateKey.slice(8, 10))
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function maxDateKey(left: string, right: string): string {
  return left > right ? left : right
}

function minDateKey(left: string, right: string): string {
  return left < right ? left : right
}
