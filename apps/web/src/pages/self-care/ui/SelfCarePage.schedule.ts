import type {
  SelfCareItemScheduleInput,
  SelfCareOccurrenceMoveInput,
  SelfCareTodayItem,
} from '@planner/contracts'

type SelfCareQueryScope =
  | 'analytics'
  | 'dashboard'
  | 'history'
  | 'items'
  | 'plan'

type ScheduleMutationVariables = {
  input: SelfCareItemScheduleInput
  itemId: string
  skipInvalidation?: boolean | undefined
}

type MoveOccurrenceMutationVariables = {
  input: SelfCareOccurrenceMoveInput
  invalidationScopes?: readonly SelfCareQueryScope[] | undefined
  occurrenceId: string
}

type SelfCareScheduleEntry = {
  item: Pick<SelfCareTodayItem['item'], 'id'>
  occurrence: Pick<
    NonNullable<SelfCareTodayItem['occurrence']>,
    'id' | 'scheduledFor'
  > | null
}

interface ScheduleSelfCareEntryOccurrenceOptions {
  entry: SelfCareScheduleEntry
  input: SelfCareItemScheduleInput
  moveNote: string
  moveOccurrence: (
    variables: MoveOccurrenceMutationVariables,
  ) => Promise<unknown>
  scheduleItem: (variables: ScheduleMutationVariables) => Promise<unknown>
}

const SELF_CARE_RESCHEDULE_SCOPES: readonly SelfCareQueryScope[] = [
  'dashboard',
  'items',
  'plan',
  'history',
  'analytics',
]

export function shouldMoveExistingSelfCareOccurrence(
  entry: SelfCareScheduleEntry,
  input: SelfCareItemScheduleInput,
): boolean {
  return Boolean(
    entry.occurrence && input.scheduledFor !== entry.occurrence.scheduledFor,
  )
}

export async function scheduleSelfCareEntryOccurrence({
  entry,
  input,
  moveNote,
  moveOccurrence,
  scheduleItem,
}: ScheduleSelfCareEntryOccurrenceOptions): Promise<void> {
  const shouldMoveExistingOccurrence = shouldMoveExistingSelfCareOccurrence(
    entry,
    input,
  )

  await scheduleItem({
    input,
    itemId: entry.item.id,
    skipInvalidation: shouldMoveExistingOccurrence,
  })

  if (!entry.occurrence || !shouldMoveExistingOccurrence) {
    return
  }

  await moveOccurrence({
    invalidationScopes: SELF_CARE_RESCHEDULE_SCOPES,
    input: {
      newDate: input.scheduledFor,
      note: moveNote,
    },
    occurrenceId: entry.occurrence.id,
  })
}
