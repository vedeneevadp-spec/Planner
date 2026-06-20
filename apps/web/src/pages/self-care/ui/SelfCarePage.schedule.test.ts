import type { SelfCareItemScheduleInput } from '@planner/contracts'
import { describe, expect, it, vi } from 'vitest'

import {
  scheduleSelfCareEntryOccurrence,
  shouldMoveExistingSelfCareOccurrence,
} from './SelfCarePage.schedule'

const scheduleInput: SelfCareItemScheduleInput = {
  currency: 'RUB',
  note: 'Перед визитом не есть',
  place: 'Клиника',
  price: 4600,
  scheduledFor: '2026-06-26',
  scheduledTime: '18:00',
  specialistContact: null,
  specialistName: 'Федор',
}

describe('scheduleSelfCareEntryOccurrence', () => {
  it('schedules the new date and marks the previous occurrence as moved', async () => {
    const calls: string[] = []
    const scheduleItem = vi.fn(() => {
      calls.push('schedule')
      return Promise.resolve()
    })
    const moveOccurrence = vi.fn(() => {
      calls.push('move')
      return Promise.resolve()
    })

    await scheduleSelfCareEntryOccurrence({
      entry: {
        item: { id: 'self-care-massage' },
        occurrence: {
          id: 'occurrence-old',
          scheduledFor: '2026-06-24',
        },
      },
      input: scheduleInput,
      moveNote: 'Дата записи изменена в настройках.',
      moveOccurrence,
      scheduleItem,
    })

    expect(calls).toEqual(['schedule', 'move'])
    expect(scheduleItem).toHaveBeenCalledWith({
      input: scheduleInput,
      itemId: 'self-care-massage',
      skipInvalidation: true,
    })
    expect(moveOccurrence).toHaveBeenCalledWith({
      invalidationScopes: [
        'dashboard',
        'items',
        'plan',
        'history',
        'analytics',
      ],
      input: {
        newDate: '2026-06-26',
        note: 'Дата записи изменена в настройках.',
      },
      occurrenceId: 'occurrence-old',
    })
  })

  it('updates the scheduled details without moving when the date is unchanged', async () => {
    const scheduleItem = vi.fn(() => Promise.resolve())
    const moveOccurrence = vi.fn(() => Promise.resolve())

    await scheduleSelfCareEntryOccurrence({
      entry: {
        item: { id: 'self-care-massage' },
        occurrence: {
          id: 'occurrence-current',
          scheduledFor: '2026-06-26',
        },
      },
      input: scheduleInput,
      moveNote: 'Дата записи изменена в настройках.',
      moveOccurrence,
      scheduleItem,
    })

    expect(
      shouldMoveExistingSelfCareOccurrence(
        {
          item: { id: 'self-care-massage' },
          occurrence: {
            id: 'occurrence-current',
            scheduledFor: '2026-06-26',
          },
        },
        scheduleInput,
      ),
    ).toBe(false)
    expect(scheduleItem).toHaveBeenCalledWith({
      input: scheduleInput,
      itemId: 'self-care-massage',
      skipInvalidation: false,
    })
    expect(moveOccurrence).not.toHaveBeenCalled()
  })
})
