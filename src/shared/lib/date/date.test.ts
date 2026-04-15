import { describe, expect, it } from 'vitest'

import { addDays, getDateKey, isBeforeDate } from './date'

describe('date helpers', () => {
  it('creates a stable date key', () => {
    expect(getDateKey(new Date(2026, 3, 15))).toBe('2026-04-15')
  })

  it('adds calendar days without mutating the source instance', () => {
    const start = new Date(2026, 3, 30)
    const next = addDays(start, 1)

    expect(getDateKey(start)).toBe('2026-04-30')
    expect(getDateKey(next)).toBe('2026-05-01')
  })

  it('compares date keys lexicographically', () => {
    expect(isBeforeDate('2026-04-14', '2026-04-15')).toBe(true)
    expect(isBeforeDate('2026-04-15', '2026-04-15')).toBe(false)
  })
})
