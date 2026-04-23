import { describe, expect, it } from 'vitest'

import { getEstimatedTaskResource, getTaskResource } from './resource'

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
  it('uses 0 when no resource is set', () => {
    expect(getTaskResource(baseTask)).toBe(0)
  })

  it('keeps explicit draining and restoring resource values', () => {
    expect(getTaskResource({ ...baseTask, resource: -3 })).toBe(-3)
    expect(getTaskResource({ ...baseTask, resource: 2 })).toBe(2)
  })

  it('estimates draining resource for important and urgent tasks', () => {
    expect(
      getEstimatedTaskResource({
        ...baseTask,
        importance: 'important',
        urgency: 'urgent',
      }),
    ).toBe(-4)
  })

  it('caps heavy scheduled tasks at 5 draining points', () => {
    expect(
      getEstimatedTaskResource({
        ...baseTask,
        importance: 'important',
        plannedEndTime: '16:00',
        plannedStartTime: '09:00',
        urgency: 'urgent',
      }),
    ).toBe(-5)
  })
})
