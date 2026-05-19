import 'fake-indexeddb/auto'

import { describe, expect, it } from 'vitest'

import { SessionApiError } from '@/features/session'

import { PlannerApiError } from '../lib/planner-api'
import { shouldKeepOptimisticMutation } from './planner-error-policy'

describe('planner error policy', () => {
  it('keeps optimistic changes when the planner API session needs recovery', () => {
    expect(
      shouldKeepOptimisticMutation(
        new PlannerApiError('Unauthorized.', {
          code: 'unauthorized',
          status: 401,
        }),
      ),
    ).toBe(true)
  })

  it('keeps optimistic changes when the session API needs recovery', () => {
    expect(
      shouldKeepOptimisticMutation(
        new SessionApiError('Unauthorized.', {
          code: 'unauthorized',
          status: 401,
        }),
      ),
    ).toBe(true)
  })
})
