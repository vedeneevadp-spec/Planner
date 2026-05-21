import 'fake-indexeddb/auto'

import { describe, expect, it } from 'vitest'

import { SessionApiError } from '@/features/session'

import { PlannerApiError } from '../lib/planner-api'
import {
  getErrorMessage,
  getPlannerQueryErrorMessage,
  shouldKeepOptimisticMutation,
} from './planner-error-policy'

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

  it('does not surface stale retryable query errors when cached planner data is visible', () => {
    expect(
      getPlannerQueryErrorMessage(new TypeError('Failed to fetch'), {
        hasCachedRecords: true,
      }),
    ).toBeNull()
  })

  it('uses a user-facing message for retryable query errors without cached planner data', () => {
    expect(
      getPlannerQueryErrorMessage(new TypeError('Failed to fetch'), {
        hasCachedRecords: false,
      }),
    ).toBe(
      'Нет соединения. Показываем сохраненные данные и синхронизируем автоматически.',
    )
  })

  it('keeps server planner errors visible even when cached planner data exists', () => {
    expect(
      getPlannerQueryErrorMessage(
        new PlannerApiError('Server refused the request.', {
          code: 'request_failed',
          status: 500,
        }),
        {
          hasCachedRecords: true,
        },
      ),
    ).toBe('Server refused the request.')
  })

  it('does not show raw browser fetch errors to users', () => {
    expect(getErrorMessage(new TypeError('Failed to fetch'))).toBe(
      'Нет соединения. Показываем сохраненные данные и синхронизируем автоматически.',
    )
  })
})
