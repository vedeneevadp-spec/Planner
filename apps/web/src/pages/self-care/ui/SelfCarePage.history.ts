import type { SelfCareHistoryResponse } from '@planner/contracts'

import { addDateDays, getDateKeyInTimeZone } from '@/shared/time/time.service'

export function getSelfCareHistoryRange(
  today: string,
  selectedTo: string | null,
) {
  const to = selectedTo && selectedTo < today ? selectedTo : today
  const from = addDateDays(to, -30)

  // The history API currently selects UTC dates. Include both neighbouring
  // dates, then select the planner's local days in the client.
  return {
    from,
    to,
    requestFrom: addDateDays(from, -1),
    requestTo: addDateDays(to, 1),
  }
}

export function selectSelfCareLocalHistory(
  history: SelfCareHistoryResponse | undefined,
  from: string,
  to: string,
  timeZone: string,
): SelfCareHistoryResponse | undefined {
  if (!history) return undefined
  const completions = history.completions.filter((completion) => {
    const date = getDateKeyInTimeZone(completion.completedAt, timeZone)
    return date >= from && date <= to
  })
  const completionIds = new Set(completions.map((completion) => completion.id))
  return {
    ...history,
    completions,
    stepCompletions: history.stepCompletions.filter((step) =>
      completionIds.has(step.completionId),
    ),
  }
}
