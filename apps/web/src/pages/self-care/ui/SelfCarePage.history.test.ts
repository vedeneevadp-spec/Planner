import {
  selfCareCompletionSchema,
  type SelfCareHistoryResponse,
} from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import {
  getSelfCareHistoryRange,
  selectSelfCareLocalHistory,
} from './SelfCarePage.history'

describe('self-care history periods', () => {
  it('opens an old bounded period and clamps future dates to today', () => {
    expect(getSelfCareHistoryRange('2026-09-22', '2026-07-15')).toEqual({
      from: '2026-06-15',
      to: '2026-07-15',
      requestFrom: '2026-06-14',
      requestTo: '2026-07-16',
    })
    expect(getSelfCareHistoryRange('2026-09-22', '2027-01-01').to).toBe(
      '2026-09-22',
    )
  })

  it.each([
    ['Asia/Novosibirsk', '2026-09-21T18:00:00Z', '2026-09-22T18:00:00Z'],
    ['America/Los_Angeles', '2026-09-23T05:00:00Z', '2026-09-22T05:00:00Z'],
  ])(
    'includes the local day boundary in %s and removes padding records',
    (timeZone, included, excluded) => {
      const history: SelfCareHistoryResponse = {
        appointmentDetails: [],
        procedureDetails: [],
        items: [],
        completions: [
          completion('included', included),
          completion('excluded', excluded),
        ],
        stepCompletions: [
          {
            id: 'step-1',
            completionId: 'included',
            isDone: true,
            stepId: 'step',
          },
          {
            id: 'step-2',
            completionId: 'excluded',
            isDone: true,
            stepId: 'step',
          },
        ],
      }
      const selected = selectSelfCareLocalHistory(
        history,
        '2026-09-22',
        '2026-09-22',
        timeZone,
      )
      expect(selected?.completions.map((item) => item.id)).toEqual(['included'])
      expect(selected?.stepCompletions.map((item) => item.id)).toEqual([
        'step-1',
      ])
    },
  )
})

function completion(id: string, completedAt: string) {
  return selfCareCompletionSchema.parse({
    id,
    itemId: 'care',
    userId: 'user',
    completedAt,
    createdAt: completedAt,
    updatedAt: completedAt,
    alternativeTitle: null,
    completedVariant: null,
    durationMinutes: null,
    measurementUnit: null,
    measurementValue: null,
    note: '',
    occurrenceId: null,
    scheduledFor: null,
    status: 'done',
    version: 1,
  })
}
