import { addDateDays, normalizeDateOnly } from '@planner/contracts'

export const MAX_AI_CONTEXT_RANGE_DAYS = 31

export function getAiDateRangeError(from?: string, to?: string): string | null {
  try {
    if (from !== undefined) normalizeDateOnly(from)
    if (to !== undefined) normalizeDateOnly(to)
  } catch {
    return 'Dates must be valid calendar dates in YYYY-MM-DD format.'
  }

  if (from && to) {
    if (from > to) return 'from must not be after to.'
    if (to > addDateDays(from, MAX_AI_CONTEXT_RANGE_DAYS - 1)) {
      return `Date ranges must not exceed ${MAX_AI_CONTEXT_RANGE_DAYS} days. Split longer periods into smaller requests.`
    }
  }

  return null
}
