import type { SelfCareItem } from './self-care.js'

/** The resume date is available again; the original recurrence anchor stays intact. */
export function updateSelfCarePausePeriods(
  item: Pick<SelfCareItem, 'isActive' | 'pausePeriods'>,
  isActive: boolean,
  date: string,
): NonNullable<SelfCareItem['pausePeriods']> {
  const periods = item.pausePeriods ?? []
  if (item.isActive === isActive) return periods
  if (!isActive) return [...periods, { from: date, to: null }]
  return periods.map((period) =>
    period.to === null
      ? { ...period, to: date < period.from ? period.from : date }
      : period,
  )
}

export function isSelfCarePausedOnDate(
  item: Pick<SelfCareItem, 'pausePeriods'>,
  date: string,
): boolean {
  return (item.pausePeriods ?? []).some(
    (period) => date >= period.from && (period.to === null || date < period.to),
  )
}
