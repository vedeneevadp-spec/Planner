import { addDateDays, serializeDateOnly } from '@/shared/time/time.service'

export function getDateKey(date: Date): string {
  return serializeDateOnly(date) ?? ''
}

export function resolveClientTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

export function formatTimeZoneOffsetLabel(date: Date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteOffsetMinutes = Math.abs(offsetMinutes)
  const hours = Math.floor(absoluteOffsetMinutes / 60)
  const minutes = absoluteOffsetMinutes % 60

  if (minutes === 0) {
    return `GMT${sign}${hours}`
  }

  return `GMT${sign}${hours}:${String(minutes).padStart(2, '0')}`
}

function parseDateKey(value: string): Date {
  const [yearRaw, monthRaw, dayRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)

  return new Date(year, month - 1, day, 12)
}

export function addDays(date: Date, amount: number): Date {
  return parseDateKey(addDateDays(getDateKey(date), amount))
}

export function formatLongDate(value: string): string {
  const parsed = parseDateKey(value)

  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(parsed)
}

export function formatShortDate(value: string): string {
  const parsed = parseDateKey(value)

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(parsed)
}

export function isBeforeDate(left: string, right: string): boolean {
  return left < right
}

export function formatTime(value: string): string {
  const [hoursRaw = '00', minutesRaw = '00'] = value.split(':')
  const hours = hoursRaw.padStart(2, '0')
  const minutes = minutesRaw.padStart(2, '0')

  return `${hours}:${minutes}`
}

export function formatTimeRange(
  startTime: string,
  endTime: string | null,
): string {
  const startLabel = formatTime(startTime)

  if (!endTime) {
    return startLabel
  }

  return `${startLabel} - ${formatTime(endTime)}`
}
