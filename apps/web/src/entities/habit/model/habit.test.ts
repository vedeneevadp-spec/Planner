import { describe, expect, it } from 'vitest'

import {
  getHabitEntryProgressValue,
  getNextHabitEntryProgressValue,
  isHabitEntryComplete,
} from './habit'

describe('habit progress helpers', () => {
  it('increments count habits until the target is reached', () => {
    const habit = {
      targetType: 'count',
      targetValue: 3,
    } as const
    const partialEntry = {
      status: 'done',
      value: 2,
    } as const

    expect(getHabitEntryProgressValue(habit, partialEntry)).toBe(2)
    expect(isHabitEntryComplete(habit, partialEntry)).toBe(false)
    expect(getNextHabitEntryProgressValue(habit, partialEntry)).toBe(3)
    expect(
      isHabitEntryComplete(habit, {
        status: 'done',
        value: 3,
      }),
    ).toBe(true)
  })

  it('does not count skipped entries as progress', () => {
    const habit = {
      targetType: 'duration',
      targetValue: 15,
    } as const
    const skippedEntry = {
      status: 'skipped',
      value: 15,
    } as const

    expect(getHabitEntryProgressValue(habit, skippedEntry)).toBe(0)
    expect(isHabitEntryComplete(habit, skippedEntry)).toBe(false)
  })
})
