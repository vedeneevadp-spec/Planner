import type {
  StoredCleaningTaskHistoryItemRecord,
  StoredCleaningTaskRecord,
  StoredCleaningTaskStateRecord,
  StoredCleaningZoneRecord,
} from './cleaning.model.js'
import {
  calculateNextCleaningDueDate,
  calculateNextGeneralCleaningDueDate,
} from './cleaning.shared.js'

export function hasCleaningScheduleChanged(
  previous: StoredCleaningTaskRecord,
  next: StoredCleaningTaskRecord,
): boolean {
  return (
    previous.scope !== next.scope ||
    previous.zoneId !== next.zoneId ||
    previous.frequencyType !== next.frequencyType ||
    previous.frequencyInterval !== next.frequencyInterval ||
    previous.customIntervalDays !== next.customIntervalDays ||
    previous.isSeasonal !== next.isSeasonal ||
    previous.seasonMonths.join(',') !== next.seasonMonths.join(',')
  )
}

export function reconcileCleaningDueDate(
  task: StoredCleaningTaskRecord,
  zone: StoredCleaningZoneRecord | null,
  state: StoredCleaningTaskStateRecord,
  latestAction: StoredCleaningTaskHistoryItemRecord | undefined,
): string | null {
  // A manual postponement owns the next date until another action closes it.
  // Imported states without history keep their date rather than invent an anchor.
  if (!latestAction || latestAction.action === 'postponed') {
    return state.nextDueAt
  }

  return task.scope === 'general'
    ? calculateNextGeneralCleaningDueDate(task, latestAction.date)
    : zone
      ? calculateNextCleaningDueDate(task, zone, latestAction.date)
      : state.nextDueAt
}
