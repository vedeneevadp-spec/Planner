import type {
  SelfCareCompletion,
  SelfCareCourseDetails,
  SelfCareItem,
  SelfCareOccurrence,
  SelfCareRitualStepDraft,
  SelfCareScheduleRule,
} from '@planner/contracts'

import { generateSelfCareOccurrencesForRange } from './self-care.shared.js'

/** Reconcile the already materialized future, preserving manual and closed slots. */
export function reconcileSelfCareSchedule(input: {
  completions: SelfCareCompletion[]
  courseDetails: SelfCareCourseDetails | null
  from: string
  item: SelfCareItem
  occurrences: SelfCareOccurrence[]
  stepDrafts?: SelfCareRitualStepDraft[]
  preserveOccurrenceId?: string | undefined
  scheduleRule: SelfCareScheduleRule
}): {
  removedIds: string[]
  updated: SelfCareOccurrence[]
  inserted: SelfCareOccurrence[]
} {
  const completionOccurrenceIds = new Set(
    input.completions.map((completion) => completion.occurrenceId),
  )
  const candidates = input.occurrences.filter(
    (occurrence) =>
      occurrence.itemId === input.item.id &&
      occurrence.generatedAt !== null &&
      occurrence.status === 'scheduled' &&
      occurrence.completedAt === null &&
      occurrence.scheduledFor >= input.from &&
      occurrence.id !== input.preserveOccurrenceId &&
      !completionOccurrenceIds.has(occurrence.id) &&
      !input.stepDrafts?.some(
        (draft) =>
          draft.stepIds.length > 0 &&
          (draft.occurrenceId === occurrence.id ||
            (draft.occurrenceId === null &&
              draft.date === occurrence.scheduledFor)),
      ),
  )
  if (candidates.length === 0) {
    return { removedIds: [], updated: [], inserted: [] }
  }
  const candidateIds = new Set(candidates.map((occurrence) => occurrence.id))
  const existing = input.occurrences.filter(
    (occurrence) => !candidateIds.has(occurrence.id),
  )
  const to = candidates.reduce(
    (date, occurrence) =>
      occurrence.scheduledFor > date ? occurrence.scheduledFor : date,
    input.from,
  )
  const desired = generateSelfCareOccurrencesForRange({
    ...input,
    existingOccurrences: existing,
    to,
  })
  const byDate = new Map(candidates.map((entry) => [entry.scheduledFor, entry]))
  const retainedIds = new Set<string>()
  const updated: SelfCareOccurrence[] = []
  const inserted: SelfCareOccurrence[] = []
  for (const occurrence of desired) {
    const previous = byDate.get(occurrence.scheduledFor)
    if (previous) {
      retainedIds.add(previous.id)
      if (
        previous.dueAt !== occurrence.dueAt ||
        previous.scheduleRuleId !== occurrence.scheduleRuleId
      ) {
        updated.push({
          ...previous,
          dueAt: occurrence.dueAt,
          scheduleRuleId: occurrence.scheduleRuleId,
          updatedAt: occurrence.updatedAt,
          version: previous.version + 1,
        })
      }
    } else {
      inserted.push(occurrence)
    }
  }
  return {
    inserted,
    removedIds: candidates
      .filter((entry) => !retainedIds.has(entry.id))
      .map((entry) => entry.id),
    updated,
  }
}
