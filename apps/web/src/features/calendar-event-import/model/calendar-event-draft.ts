import type { TaskComposerDraft } from '@/features/task-create'
import {
  formatDateOnlyForLocale,
  getDateKeyInTimeZone,
  getTimeInTimeZone,
} from '@/shared/time/time.service'

import type { CalendarEventDraft } from '../lib/native-calendar-events'

export function toTaskComposerDraft(
  event: CalendarEventDraft,
  plannerTimeZone: string,
): TaskComposerDraft {
  const begin = validInstant(event.beginTime)
  const end = validInstant(event.endTime)
  const timeZone = event.allDay ? 'UTC' : plannerTimeZone
  const date = begin ? getDateKeyInTimeZone(begin, timeZone) : null
  const endDate = end ? getDateKeyInTimeZone(end, timeZone) : null
  const canUseEnd = Boolean(begin && end && end > begin)
  const note = [event.description.trim()]
  if (
    event.location.trim() &&
    !event.description.includes(event.location.trim())
  ) {
    note.push(`Место: ${event.location.trim()}`)
  }
  // The current task form has one planned day. Preserve a later end in its note.
  if (canUseEnd && endDate !== date && !event.allDay) {
    note.push(
      `Окончание: ${formatDateOnlyForLocale({ localDate: endDate! })} ${getTimeInTimeZone(end!, timeZone)}`,
    )
  }
  return {
    requestId: event.requestId,
    title: event.title.trim(),
    note: note.filter(Boolean).join('\n\n'),
    plannedDate: date,
    plannedStartTime:
      begin && !event.allDay ? getTimeInTimeZone(begin, timeZone) : null,
    plannedEndTime:
      canUseEnd && !event.allDay && endDate === date
        ? getTimeInTimeZone(end!, timeZone)
        : null,
    preservePlannedDate: true,
  }
}

function validInstant(value: number | null): Date | null {
  return value !== null &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 253402300799999
    ? new Date(value)
    : null
}
