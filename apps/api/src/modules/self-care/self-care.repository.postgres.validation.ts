import {
  type SelfCareOccurrence,
  type SelfCareRitualStep,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'

export function assertSelfCareVersion(
  entityType: string,
  entityId: string,
  expectedVersion: number | null | undefined,
  actualVersion: number | null,
): void {
  if (expectedVersion === undefined || expectedVersion === actualVersion) {
    return
  }

  throw new HttpError(
    409,
    'self_care_version_conflict',
    'Self-care data was changed on the server.',
    { actualVersion, entityId, entityType, expectedVersion },
  )
}

export function assertSelfCareOccurrenceOpen(
  occurrence: SelfCareOccurrence,
): void {
  if (occurrence.status === 'scheduled' || occurrence.status === 'missed') {
    return
  }

  throw new HttpError(
    409,
    'self_care_occurrence_closed',
    'The self-care occurrence was already completed or changed.',
    {
      actualVersion: occurrence.version,
      entityId: occurrence.id,
      entityType: 'occurrence',
    },
  )
}

export function assertRitualCompletionSteps(
  itemId: string,
  availableSteps: readonly Pick<SelfCareRitualStep, 'id'>[],
  submittedSteps: readonly { stepId: string }[],
): void {
  const availableStepIds = new Set(availableSteps.map((step) => step.id))
  const submittedStepIds = submittedSteps.map((step) => step.stepId)

  if (new Set(submittedStepIds).size !== submittedStepIds.length) {
    throw new HttpError(
      400,
      'self_care_ritual_completion_invalid_step',
      'Self-care ritual completion contains a duplicate step.',
    )
  }

  if (submittedStepIds.every((stepId) => availableStepIds.has(stepId))) {
    return
  }

  throw new HttpError(
    409,
    'self_care_ritual_step_conflict',
    'Self-care ritual steps changed before this completion was saved.',
    { entityId: itemId, entityType: 'item' },
  )
}
export function resolveSelfCareReminderTimeZone(
  explicitTimeZone: string | null | undefined,
  fallbackTimeZone?: string | null,
): string {
  const timeZone = explicitTimeZone?.trim() || fallbackTimeZone?.trim() || 'UTC'

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    return timeZone
  } catch {
    return 'UTC'
  }
}
