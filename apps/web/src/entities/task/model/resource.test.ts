import { describe, expect, it } from 'vitest'

import { getTaskResource } from './resource'

const baseTask = {
  importance: 'not_important',
  note: '',
  plannedEndTime: null,
  plannedStartTime: null,
  resource: null,
  title: 'Task',
  urgency: 'not_urgent',
} as const

describe('getTaskResource', () => {
  it('uses 2 as the default lightweight estimate', () => {
    expect(getTaskResource(baseTask)).toBe(2)
  })

  it('raises resource for important and urgent tasks', () => {
    expect(
      getTaskResource({
        ...baseTask,
        importance: 'important',
        urgency: 'urgent',
      }),
    ).toBe(4)
  })

  it('caps heavy scheduled tasks at 5 points', () => {
    expect(
      getTaskResource({
        ...baseTask,
        importance: 'important',
        plannedEndTime: '16:00',
        plannedStartTime: '09:00',
        urgency: 'urgent',
      }),
    ).toBe(5)
  })
})
