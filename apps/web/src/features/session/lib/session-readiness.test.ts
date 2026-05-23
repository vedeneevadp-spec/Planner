import { describe, expect, it } from 'vitest'

import type { SessionAuthLifecycleStatus } from '../model/session-auth-context'
import {
  getSessionReadinessConnectionView,
  resolveSessionFeatureReadiness,
  resolveSessionReadiness,
  type SessionReadinessStatus,
} from './session-readiness'

describe('session readiness', () => {
  it.each([
    {
      expected: {
        canRenderAppContent: true,
        canUseProtectedApi: true,
        canWriteProtectedData: true,
        reason: 'ready',
        status: 'ready',
      },
      input: {
        auth: authState({
          canUseProtectedApi: true,
          lifecycleStatus: 'authenticated',
        }),
        hasPlannerSession: true,
        isPlannerSessionPending: false,
      },
      name: 'ready when auth and planner session are both usable',
    },
    {
      expected: {
        canRenderAppContent: true,
        canUseProtectedApi: false,
        canWriteProtectedData: false,
        reason: 'auth_restoring',
        status: 'restoringWithCache',
      },
      input: {
        auth: authState({
          canUseProtectedApi: false,
          lifecycleStatus: 'restoring',
        }),
        hasPlannerSession: true,
        isPlannerSessionPending: true,
      },
      name: 'restoring with cache keeps app content renderable',
    },
    {
      expected: {
        canRenderAppContent: false,
        canUseProtectedApi: false,
        canWriteProtectedData: false,
        reason: 'auth_restoring',
        status: 'blockedAuth',
      },
      input: {
        auth: authState({
          canUseProtectedApi: false,
          lifecycleStatus: 'restoring',
        }),
        hasPlannerSession: false,
        isPlannerSessionPending: true,
      },
      name: 'restoring without cache blocks app content',
    },
    {
      expected: {
        canRenderAppContent: true,
        canUseProtectedApi: false,
        canWriteProtectedData: false,
        reason: 'auth_deferred',
        status: 'offlineWithCache',
      },
      input: {
        auth: authState({
          canUseProtectedApi: false,
          lifecycleStatus: 'deferred',
        }),
        hasCachedData: true,
        hasPlannerSession: false,
        isPlannerSessionPending: false,
      },
      name: 'auth deferred with feature cache becomes offline with cache',
    },
    {
      expected: {
        canRenderAppContent: false,
        canUseProtectedApi: false,
        canWriteProtectedData: false,
        reason: 'unauthorized',
        status: 'blockedAuth',
      },
      input: {
        auth: authState({
          canUseProtectedApi: true,
          lifecycleStatus: 'authenticated',
        }),
        hasPlannerSession: false,
        hasUnauthorizedPlannerSessionError: true,
        isPlannerSessionPending: false,
      },
      name: 'unauthorized planner session error blocks without cache',
    },
    {
      expected: {
        canRenderAppContent: true,
        canUseProtectedApi: false,
        canWriteProtectedData: false,
        reason: 'unauthorized',
        status: 'offlineWithCache',
      },
      input: {
        auth: authState({
          canUseProtectedApi: true,
          lifecycleStatus: 'authenticated',
        }),
        hasPlannerSession: true,
        hasUnauthorizedPlannerSessionError: true,
        isPlannerSessionPending: false,
      },
      name: 'unauthorized planner session error keeps cached content visible',
    },
    {
      expected: {
        canRenderAppContent: false,
        canUseProtectedApi: true,
        canWriteProtectedData: false,
        reason: 'planner_error',
        status: 'serverError',
      },
      input: {
        auth: authState({
          canUseProtectedApi: true,
          lifecycleStatus: 'authenticated',
        }),
        hasPlannerSession: false,
        hasPlannerSessionError: true,
        isPlannerSessionPending: false,
      },
      name: 'planner session error without cache becomes server error',
    },
    {
      expected: {
        canRenderAppContent: true,
        canUseProtectedApi: true,
        canWriteProtectedData: false,
        reason: 'planner_error',
        status: 'offlineWithCache',
      },
      input: {
        auth: authState({
          canUseProtectedApi: true,
          lifecycleStatus: 'authenticated',
        }),
        hasCachedData: true,
        hasPlannerSession: false,
        hasPlannerSessionError: true,
        isPlannerSessionPending: false,
      },
      name: 'planner session error with cache becomes offline with cache',
    },
  ])('$name', ({ expected, input }) => {
    expect(resolveSessionReadiness(input)).toMatchObject(expected)
  })

  it.each([
    {
      expected: {
        errorMessage: null,
        label: 'Connected',
      },
      input: {
        auth: authState({
          canUseProtectedApi: true,
          lifecycleStatus: 'authenticated',
        }),
        hasPlannerSession: true,
        isPlannerSessionPending: false,
      },
      readinessStatus: 'ready',
      name: 'ready',
    },
    {
      expected: {
        errorMessage: null,
        label: 'Loading',
      },
      input: {
        auth: authState({
          canUseProtectedApi: false,
          lifecycleStatus: 'restoring',
        }),
        hasCachedData: true,
        hasPlannerSession: true,
        isPlannerSessionPending: true,
      },
      readinessStatus: 'restoringWithCache',
      name: 'restoring with cache',
    },
    {
      expected: {
        errorMessage: 'Auth session unavailable',
        label: 'Connection issue',
      },
      input: {
        auth: authState({
          canUseProtectedApi: false,
          lifecycleStatus: 'deferred',
        }),
        hasCachedData: true,
        hasPlannerSession: false,
        isPlannerSessionPending: false,
      },
      readinessStatus: 'offlineWithCache',
      name: 'offline with cache',
    },
    {
      expected: {
        errorMessage: 'Planner session unavailable',
        label: 'Connection issue',
      },
      input: {
        auth: authState({
          canUseProtectedApi: true,
          lifecycleStatus: 'authenticated',
        }),
        hasPlannerSession: false,
        hasPlannerSessionError: true,
        isPlannerSessionPending: false,
      },
      readinessStatus: 'serverError',
      name: 'server error',
    },
  ] satisfies Array<{
    expected: {
      errorMessage: string | null
      label: string
    }
    input: Parameters<typeof resolveSessionReadiness>[0]
    name: string
    readinessStatus: SessionReadinessStatus
  }>)('maps $name to connection view', ({ expected, input }) => {
    const readiness = resolveSessionReadiness(input)

    expect(getSessionReadinessConnectionView(readiness)).toEqual(expected)
  })

  it.each([
    {
      expected: {
        isApiEnabled: false,
        status: 'ready',
      },
      input: {
        auth: authState({
          canUseProtectedApi: true,
          lifecycleStatus: 'authenticated',
        }),
        hasCachedData: true,
        hasPlannerSession: false,
        isPlannerSessionPending: false,
      },
      name: 'does not enable feature API from cache without planner session',
    },
    {
      expected: {
        isApiEnabled: true,
        status: 'ready',
      },
      input: {
        auth: authState({
          canUseProtectedApi: true,
          lifecycleStatus: 'authenticated',
        }),
        hasPlannerSession: true,
        isPlannerSessionPending: false,
      },
      name: 'enables feature API only when readiness is ready',
    },
    {
      expected: {
        isApiEnabled: false,
        status: 'ready',
      },
      input: {
        auth: authState({
          canUseProtectedApi: true,
          lifecycleStatus: 'authenticated',
        }),
        hasPlannerSession: true,
        isFeatureEnabled: false,
        isPlannerSessionPending: false,
      },
      name: 'keeps ready feature disabled when the feature opts out',
    },
    {
      expected: {
        isApiEnabled: false,
        status: 'restoringWithCache',
      },
      input: {
        auth: authState({
          canUseProtectedApi: false,
          lifecycleStatus: 'restoring',
        }),
        hasCachedData: true,
        hasPlannerSession: true,
        isPlannerSessionPending: true,
      },
      name: 'does not enable feature API while auth restores over cache',
    },
    {
      expected: {
        isApiEnabled: false,
        status: 'serverError',
      },
      input: {
        auth: authState({
          canUseProtectedApi: true,
          lifecycleStatus: 'authenticated',
        }),
        hasPlannerSession: false,
        hasPlannerSessionError: true,
        isPlannerSessionPending: false,
      },
      name: 'does not enable feature API without planner session',
    },
    {
      expected: {
        isApiEnabled: true,
        status: 'ready',
      },
      input: {
        auth: authState({
          canUseProtectedApi: true,
          lifecycleStatus: 'disabled',
        }),
        hasPlannerSession: true,
        isPlannerSessionPending: false,
      },
      name: 'keeps disabled auth compatibility behind the same helper',
    },
  ])('$name', ({ expected, input }) => {
    const result = resolveSessionFeatureReadiness(input)

    expect({
      isApiEnabled: result.isApiEnabled,
      status: result.readiness.status,
    }).toEqual(expected)
  })
})

function authState(overrides: {
  canUseProtectedApi: boolean
  lifecycleStatus: SessionAuthLifecycleStatus
}) {
  return {
    canUseProtectedApi: overrides.canUseProtectedApi,
    isAuthEnabled: true,
    isLoading: overrides.lifecycleStatus === 'restoring',
    lifecycleStatus: overrides.lifecycleStatus,
  }
}
