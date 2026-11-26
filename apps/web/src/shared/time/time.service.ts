import {
  EMERGENCY_FALLBACK_TIME_ZONE,
  getDeviceTimeZone,
  getTimeInTimeZone,
} from '@planner/contracts'

export function getCurrentDeviceTime(): string {
  return getTimeInTimeZone(
    new Date(),
    getDeviceTimeZone() ?? EMERGENCY_FALLBACK_TIME_ZONE,
  )
}

export {
  addDateDays,
  addDateMonthsClamped,
  compareDateOnly,
  EMERGENCY_FALLBACK_TIME_ZONE,
  enumerateDateRange,
  formatDateOnlyForLocale,
  formatForUser,
  getDateDayOfMonth,
  getDateDistance,
  getDateKeyInTimeZone,
  getDateMonthKey,
  getDayRangeUtc,
  getDeviceTimeZone,
  getIsoWeekday,
  getIsoWeekStartDate,
  getMonthStartDate,
  getPlannerTimeZone,
  getTimeInTimeZone,
  getTodayDate,
  isValidTimeZone,
  makeFixedZoneDateTime,
  normalizeDateOnly,
  normalizeLocalTime,
  normalizeTimeZone,
  serializeDateOnly,
  timeService,
  toIsoUtc,
} from '@planner/contracts'
