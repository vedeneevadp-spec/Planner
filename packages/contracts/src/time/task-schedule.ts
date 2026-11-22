import type { Task, TaskScheduleInput } from '../task.js'
import { getDateKeyInTimeZone, getTimeInTimeZone } from './time.service.js'

export function getDisplayedTaskSchedule(
  task: TaskScheduleInput & Pick<Task, 'schedule'>,
  displayTimeZone: string,
): TaskScheduleInput & { plannedEndDate: string | null } {
  const { plannedDate, plannedStartTime, plannedEndTime, schedule } = task
  if (schedule?.kind === 'fixed_zone_datetime') {
    const start = new Date(schedule.instantUtc)
    if (Number.isFinite(start.getTime())) {
      const startMinutes = timeMinutes(plannedStartTime ?? schedule.localTime)
      const endMinutes = timeMinutes(plannedEndTime)
      // Keep the block's elapsed duration, even if its displayed end is on another day.
      const end =
        startMinutes !== null &&
        endMinutes !== null &&
        endMinutes > startMinutes
          ? new Date(start.getTime() + (endMinutes - startMinutes) * 60_000)
          : null
      return {
        plannedDate: getDateKeyInTimeZone(start, displayTimeZone),
        plannedStartTime: getTimeInTimeZone(start, displayTimeZone),
        plannedEndDate: end && getDateKeyInTimeZone(end, displayTimeZone),
        plannedEndTime: end && getTimeInTimeZone(end, displayTimeZone),
      }
    }
  }

  return {
    plannedDate,
    plannedStartTime,
    plannedEndDate: plannedEndTime ? plannedDate : null,
    plannedEndTime,
  }
}

function timeMinutes(value: string | null): number | null {
  if (!value || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) return null
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
}
