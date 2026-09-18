import { describe, expect, it } from 'vitest'

import {
  getResourceFromValue,
  getResourceValueFromTaskResource,
  type ResourceValue,
} from './task-meta'

describe('task resource form values', () => {
  it('defaults an empty selection to neutral, including previously unrated tasks', () => {
    expect(getResourceFromValue('')).toBe(0)
    expect(getResourceValueFromTaskResource(null)).toBe('')
    expect(getResourceFromValue(getResourceValueFromTaskResource(null))).toBe(0)
  })

  it.each<[ResourceValue, number]>([
    ['0', 0],
    ['-4', -4],
    ['-1', -1],
    ['1', 1],
    ['4', 4],
  ])(
    'preserves the meaning of %j through a form round trip',
    (value, resource) => {
      expect(getResourceFromValue(value)).toBe(resource)
      expect(getResourceValueFromTaskResource(resource)).toBe(value)
    },
  )

  it.each([-5, 5])(
    'still caps a legacy value %s at the current resource scale',
    (resource) => {
      expect(
        getResourceFromValue(getResourceValueFromTaskResource(resource)),
      ).toBe(resource < 0 ? -4 : 4)
    },
  )
})
