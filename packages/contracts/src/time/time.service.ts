import type {
  FixedZoneDateTimeValue,
  IanaTimeZone,
  PlannerScheduleValue,
  TimeService,
  TimeZoneMode,
} from './time.types.js'

export const EMERGENCY_FALLBACK_TIME_ZONE = 'UTC'

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const LOCAL_TIME_PATTERN = /^\d{2}:\d{2}$/u
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

interface DateParts {
  day: number
  month: number
  year: number
}

interface ZonedDateTimeParts extends DateParts {
  hour: number
  minute: number
  second: number
}

interface PlainDateTimeParts extends DateParts {
  hour: number
  minute: number
}

export const timeService: TimeService = {
  getDeviceTimeZone,
  getPlannerTimeZone,
  getTodayDate,
  getDayRangeUtc,
  makeFixedZoneDateTime,
  formatForUser,
}

export function getDeviceTimeZone(): IanaTimeZone | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export function getPlannerTimeZone(input: {
  deviceTimeZone?: IanaTimeZone | null
  timeZoneMode?: TimeZoneMode | null
  userTimeZone?: IanaTimeZone | null
  workspaceTimeZone?: IanaTimeZone | null
}): IanaTimeZone {
  const mode = input.timeZoneMode ?? 'device'

  if (mode === 'manual') {
    return normalizeTimeZone(input.userTimeZone)
  }

  if (mode === 'workspace') {
    return normalizeTimeZone(input.workspaceTimeZone)
  }

  return normalizeTimeZone(input.deviceTimeZone)
}

export function getTodayDate(timeZone: IanaTimeZone): string {
  return getDateKeyInTimeZone(nowDate(), normalizeTimeZone(timeZone))
}

export function getDayRangeUtc(input: {
  localDate: string
  timeZone: IanaTimeZone
}): { endUtc: string; startUtc: string } {
  const localDate = normalizeDateOnly(input.localDate)
  const timeZone = normalizeTimeZone(input.timeZone)
  const startUtc = resolveInstantForLocalDateTime({
    localDate,
    localTime: '00:00',
    timeZone,
  })
  const endUtc = resolveInstantForLocalDateTime({
    localDate: addDateDays(localDate, 1),
    localTime: '00:00',
    timeZone,
  })

  return {
    endUtc: toIsoUtc(endUtc),
    startUtc: toIsoUtc(startUtc),
  }
}

export function makeFixedZoneDateTime(input: {
  localDate: string
  localTime: string
  timeZone: IanaTimeZone
}): FixedZoneDateTimeValue {
  const localDate = normalizeDateOnly(input.localDate)
  const localTime = normalizeLocalTime(input.localTime)
  const timeZone = normalizeTimeZone(input.timeZone)
  const instantMs = resolveInstantForLocalDateTime({
    localDate,
    localTime,
    timeZone,
  })

  return {
    instantUtc: toIsoUtc(instantMs),
    kind: 'fixed_zone_datetime',
    localDate,
    localTime,
    timeZone,
  }
}

export function formatForUser(input: {
  displayTimeZone: IanaTimeZone
  locale?: string
  value: PlannerScheduleValue
}): string {
  const locale = input.locale ?? 'ru-RU'
  const displayTimeZone = normalizeTimeZone(input.displayTimeZone)

  if (input.value.kind === 'date_only') {
    return formatDateOnlyForLocale({
      localDate: input.value.localDate,
      locale,
      options: DEFAULT_DATE_ONLY_FORMAT_OPTIONS,
    })
  }

  if (input.value.kind === 'floating_local_time') {
    return input.value.recurrenceRule
      ? `${input.value.localTime}, ${input.value.recurrenceRule}`
      : input.value.localTime
  }

  const eventDate = formatDateOnlyForLocale({
    localDate: input.value.localDate,
    locale,
    options: DEFAULT_DATE_ONLY_FORMAT_OPTIONS,
  })
  const eventLabel = `${eventDate}, ${input.value.localTime}`

  if (input.value.timeZone === displayTimeZone) {
    return eventLabel
  }

  const displayParts = getZonedDateTimeParts(
    parseInstant(input.value.instantUtc),
    displayTimeZone,
  )
  const displayDate = formatDateOnlyForLocale({
    localDate: formatDateParts(
      displayParts.year,
      displayParts.month,
      displayParts.day,
    ),
    locale,
    options: DEFAULT_DATE_ONLY_FORMAT_OPTIONS,
  })
  const displayTime = `${pad2(displayParts.hour)}:${pad2(displayParts.minute)}`

  return `${eventLabel} ${input.value.timeZone} (${displayDate}, ${displayTime} ${displayTimeZone})`
}

export function normalizeTimeZone(
  timeZone: IanaTimeZone | null | undefined,
): IanaTimeZone {
  const candidate = timeZone?.trim()

  if (!candidate) {
    return EMERGENCY_FALLBACK_TIME_ZONE
  }

  if (!isValidTimeZone(candidate)) {
    return EMERGENCY_FALLBACK_TIME_ZONE
  }

  return candidate
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(zeroDate())

    return true
  } catch {
    return false
  }
}

export function normalizeDateOnly(value: string): string {
  const candidate = value.trim()

  if (!DATE_ONLY_PATTERN.test(candidate)) {
    throw new Error(`Invalid date_only value: ${value}`)
  }

  const parts = parseDateOnly(candidate)

  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > getDaysInMonth(parts.year, parts.month)
  ) {
    throw new Error(`Invalid date_only value: ${value}`)
  }

  return candidate
}

export function normalizeLocalTime(value: string): string {
  const candidate = value.trim()

  if (!LOCAL_TIME_PATTERN.test(candidate)) {
    throw new Error(`Invalid local time value: ${value}`)
  }

  const [hours, minutes] = parseLocalTime(candidate)

  if (hours > 23 || minutes > 59) {
    throw new Error(`Invalid local time value: ${value}`)
  }

  return `${pad2(hours)}:${pad2(minutes)}`
}

export function addDateDays(localDate: string, days: number): string {
  const parts = parseDateOnly(normalizeDateOnly(localDate))
  const shifted = civilFromDays(
    daysFromCivil(parts.year, parts.month, parts.day) + days,
  )

  return formatDateParts(shifted.year, shifted.month, shifted.day)
}

export function addDateMonthsClamped(
  localDate: string,
  months: number,
  targetDay?: number,
): string {
  const parts = parseDateOnly(normalizeDateOnly(localDate))
  const day = targetDay ?? parts.day
  const totalMonths = parts.year * 12 + parts.month - 1 + months
  const year = Math.floor(totalMonths / 12)
  const month = positiveModulo(totalMonths, 12) + 1
  const clampedDay = Math.min(day, getDaysInMonth(year, month))

  return formatDateParts(year, month, clampedDay)
}

export function enumerateDateRange(from: string, to: string): string[] {
  const normalizedFrom = normalizeDateOnly(from)
  const normalizedTo = normalizeDateOnly(to)

  if (normalizedFrom > normalizedTo) {
    return []
  }

  const dates: string[] = []
  let cursor = normalizedFrom

  while (cursor <= normalizedTo) {
    dates.push(cursor)
    cursor = addDateDays(cursor, 1)
  }

  return dates
}

export function getDateDayOfMonth(localDate: string): number {
  return parseDateOnly(normalizeDateOnly(localDate)).day
}

export function getDateDistance(left: string, right: string): number {
  const leftParts = parseDateOnly(normalizeDateOnly(left))
  const rightParts = parseDateOnly(normalizeDateOnly(right))

  return (
    daysFromCivil(rightParts.year, rightParts.month, rightParts.day) -
    daysFromCivil(leftParts.year, leftParts.month, leftParts.day)
  )
}

export function getDateMonthKey(localDate: string): string {
  return normalizeDateOnly(localDate).slice(0, 7)
}

export function getIsoWeekday(localDate: string): number {
  const parts = parseDateOnly(normalizeDateOnly(localDate))

  return (
    positiveModulo(daysFromCivil(parts.year, parts.month, parts.day) + 3, 7) + 1
  )
}

export function getIsoWeekStartDate(localDate: string): string {
  return addDateDays(localDate, 1 - getIsoWeekday(localDate))
}

export function getMonthStartDate(localDate: string): string {
  const parts = parseDateOnly(normalizeDateOnly(localDate))

  return formatDateParts(parts.year, parts.month, 1)
}

export function serializeDateOnly(value: string | Date | null): string | null {
  if (value === null) {
    return null
  }

  if (typeof value === 'string') {
    return normalizeDateOnly(value.slice(0, 10))
  }

  const year = value.getUTCFullYear()
  const month = value.getUTCMonth() + 1
  const day = value.getUTCDate()

  return normalizeDateOnly(formatDateParts(year, month, day))
}

export function compareDateOnly(left: string, right: string): number {
  const normalizedLeft = normalizeDateOnly(left)
  const normalizedRight = normalizeDateOnly(right)

  if (normalizedLeft === normalizedRight) {
    return 0
  }

  return normalizedLeft < normalizedRight ? -1 : 1
}

export function getDateKeyInTimeZone(
  instant: Date | string,
  timeZone: IanaTimeZone,
): string {
  const parts = getZonedDateTimeParts(
    typeof instant === 'string' ? parseInstant(instant) : instant,
    normalizeTimeZone(timeZone),
  )

  return formatDateParts(parts.year, parts.month, parts.day)
}

export function getTimeInTimeZone(
  instant: Date | string,
  timeZone: IanaTimeZone,
): string {
  const parts = getZonedDateTimeParts(
    typeof instant === 'string' ? parseInstant(instant) : instant,
    normalizeTimeZone(timeZone),
  )

  return `${pad2(parts.hour)}:${pad2(parts.minute)}`
}

export function toIsoUtc(instantMs: number): string {
  return new Date(instantMs).toISOString()
}

function resolveInstantForLocalDateTime(input: {
  localDate: string
  localTime: string
  timeZone: IanaTimeZone
}): number {
  const target = parsePlainDateTime(input.localDate, input.localTime)
  const targetKey = plainDateTimeKey(target)
  const nominalUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
  )
  const start = nominalUtc - 18 * HOUR_MS
  const end = nominalUtc + 18 * HOUR_MS
  const exactMatches: number[] = []
  let nearestLater: number | null = null

  for (let cursor = start; cursor <= end; cursor += MINUTE_MS) {
    const parts = getZonedDateTimeParts(new Date(cursor), input.timeZone)
    const cursorKey = plainDateTimeKey(parts)

    if (cursorKey === targetKey) {
      exactMatches.push(cursor)
    }

    if (nearestLater === null && cursorKey > targetKey) {
      nearestLater = cursor
    }
  }

  if (exactMatches.length > 0) {
    return exactMatches[0]!
  }

  if (nearestLater !== null) {
    return nearestLater
  }

  throw new Error(
    `Unable to resolve local datetime ${input.localDate} ${input.localTime} in ${input.timeZone}`,
  )
}

function getZonedDateTimeParts(
  date: Date,
  timeZone: IanaTimeZone,
): ZonedDateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  })
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )

  return {
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    month: Number(parts.month),
    second: Number(parts.second),
    year: Number(parts.year),
  }
}

const DEFAULT_DATE_ONLY_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}

export function formatDateOnlyForLocale(input: {
  localDate: string
  locale?: string
  options?: Intl.DateTimeFormatOptions
}): string {
  const parts = parseDateOnly(normalizeDateOnly(input.localDate))

  return new Intl.DateTimeFormat(input.locale ?? 'ru-RU', {
    ...(input.options ?? DEFAULT_DATE_ONLY_FORMAT_OPTIONS),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)))
}

function parsePlainDateTime(
  localDate: string,
  localTime: string,
): PlainDateTimeParts {
  const date = parseDateOnly(localDate)
  const [hour, minute] = parseLocalTime(localTime)

  return {
    ...date,
    hour,
    minute,
  }
}

function parseDateOnly(value: string): DateParts {
  const [yearRaw, monthRaw, dayRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    throw new Error(`Invalid date_only value: ${value}`)
  }

  return { day, month, year }
}

function civilFromDays(days: number): DateParts {
  const shiftedDays = days + 719_468
  const era = Math.floor(shiftedDays / 146_097)
  const dayOfEra = shiftedDays - era * 146_097
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1_460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  )
  const yearBeforeMonthAdjustment = yearOfEra + era * 400
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1
  const month = monthPrime + (monthPrime < 10 ? 3 : -9)
  const year = yearBeforeMonthAdjustment + (month <= 2 ? 1 : 0)

  return { day, month, year }
}

function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(adjustedYear / 400)
  const yearOfEra = adjustedYear - era * 400
  const monthPrime = month + (month > 2 ? -3 : 9)
  const dayOfYear = Math.floor((153 * monthPrime + 2) / 5) + day - 1
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear

  return era * 146_097 + dayOfEra - 719_468
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo
}

function parseLocalTime(value: string): [number, number] {
  const [hoursRaw, minutesRaw] = value.split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    throw new Error(`Invalid local time value: ${value}`)
  }

  return [hours, minutes]
}

function parseInstant(value: string): Date {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid instant value: ${value}`)
  }

  return parsed
}

function plainDateTimeKey(parts: PlainDateTimeParts): string {
  return `${formatDateParts(parts.year, parts.month, parts.day)}T${pad2(
    parts.hour,
  )}:${pad2(parts.minute)}`
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function nowDate(): Date {
  return new Date()
}

function zeroDate(): Date {
  return new Date(0)
}
