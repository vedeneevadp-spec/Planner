export function getDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function parseDateKey(value: string): Date {
  const [yearRaw, monthRaw, dayRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)

  return new Date(year, month - 1, day, 12)
}

export function addDays(date: Date, amount: number): Date {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + amount)

  return nextDate
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
