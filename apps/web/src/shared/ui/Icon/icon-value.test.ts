import { describe, expect, it } from 'vitest'

import { canRenderIconValue } from './icon-value'

const uploadedIcons = [{ id: 'asset-1', label: 'Моя иконка', value: 'data:' }]

describe('canRenderIconValue', () => {
  it.each([
    ['bundled icon name', 'home'],
    ['bundled svg value', 'svg:mic'],
    ['emoji', '🧘'],
    ['symbol', '✦'],
    ['short text mark', 'AB'],
    ['available uploaded image', 'image:asset-1'],
  ])('renders a %s', (_label, value) => {
    expect(canRenderIconValue(value, uploadedIcons)).toBe(true)
  })

  it.each([
    ['missing value', null],
    ['blank value', '  '],
    ['icon name the app does not ship', 'credit-card'],
    ['single-word unknown icon name', 'passport'],
    ['unknown svg value', 'svg:credit-card'],
    ['uploaded image that is not available', 'image:asset-missing'],
  ])('skips a %s', (_label, value) => {
    expect(canRenderIconValue(value, uploadedIcons)).toBe(false)
  })
})
