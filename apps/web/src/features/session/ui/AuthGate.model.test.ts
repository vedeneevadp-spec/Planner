import { describe, expect, it } from 'vitest'

import {
  type AuthGateView,
  resolveAuthGateView,
  type ResolveAuthGateViewInput,
} from './AuthGate.model'

const DEFAULT_INPUT: ResolveAuthGateViewInput = {
  accessToken: null,
  canResolvePlannerSession: false,
  canUseProtectedApi: false,
  hasAuthNotice: false,
  hasPlannerSession: false,
  hasPlannerSessionError: false,
  hasUnauthorizedPlannerSessionError: false,
  isAuthEnabled: true,
  isLoading: false,
  isNativeSessionRuntime: false,
  isPasswordRecovery: false,
  isPlannerSessionPending: false,
  isRecovering: false,
  lifecycleStatus: 'signed_out',
}

describe('AuthGate view model', () => {
  it.each([
    {
      expected: {
        panel: 'disabled_auth_configuration',
        type: 'status_panel',
      },
      name: 'blocks disabled auth builds that cannot bootstrap a planner session',
      override: {
        isAuthEnabled: false,
        lifecycleStatus: 'disabled',
      },
    },
    {
      expected: {
        panel: 'restoring_saved_sign_in',
        type: 'status_panel',
      },
      name: 'shows restore progress while browser auth storage is restoring',
      override: {
        hasPlannerSession: true,
        isLoading: true,
        lifecycleStatus: 'restoring',
      },
    },
    {
      expected: {
        type: 'children',
      },
      name: 'keeps cached content visible during native restore',
      override: {
        hasPlannerSession: true,
        isLoading: true,
        isNativeSessionRuntime: true,
        lifecycleStatus: 'restoring',
      },
    },
    {
      expected: {
        type: 'children',
      },
      name: 'renders protected content for an authenticated planner session',
      override: {
        accessToken: 'access-token',
        canResolvePlannerSession: true,
        canUseProtectedApi: true,
        hasPlannerSession: true,
        lifecycleStatus: 'authenticated',
      },
    },
    {
      expected: {
        type: 'children',
      },
      name: 'keeps cached content visible for a deferred native device session',
      override: {
        hasPlannerSession: true,
        isNativeSessionRuntime: true,
        lifecycleStatus: 'deferred',
      },
    },
    {
      expected: {
        panel: 'restore_required',
        type: 'status_panel',
      },
      name: 'does not treat cached planner data as a browser sign-in',
      override: {
        hasPlannerSession: true,
        lifecycleStatus: 'signed_out',
      },
    },
    {
      expected: {
        panel: 'session_ended',
        type: 'status_panel',
      },
      name: 'asks the user to sign in again after an unrecovered 401',
      override: {
        accessToken: 'access-token',
        canResolvePlannerSession: true,
        canUseProtectedApi: true,
        hasUnauthorizedPlannerSessionError: true,
        lifecycleStatus: 'authenticated',
      },
    },
    {
      expected: {
        panel: 'restoring_saved_sign_in',
        type: 'status_panel',
      },
      name: 'keeps recovery progress visible while retrying after a 401',
      override: {
        accessToken: 'access-token',
        canResolvePlannerSession: true,
        canUseProtectedApi: true,
        hasUnauthorizedPlannerSessionError: true,
        isRecovering: true,
        lifecycleStatus: 'authenticated',
      },
    },
    {
      expected: {
        panel: 'planner_loading',
        type: 'status_panel',
      },
      name: 'shows planner loading while resolving an authenticated session',
      override: {
        accessToken: 'access-token',
        canResolvePlannerSession: true,
        canUseProtectedApi: true,
        isPlannerSessionPending: true,
        lifecycleStatus: 'authenticated',
      },
    },
    {
      expected: {
        panel: 'planner_session_error',
        type: 'status_panel',
      },
      name: 'shows planner errors when no cached session can be rendered',
      override: {
        accessToken: 'access-token',
        canResolvePlannerSession: true,
        canUseProtectedApi: true,
        hasPlannerSessionError: true,
        lifecycleStatus: 'authenticated',
      },
    },
    {
      expected: {
        type: 'auth_form',
      },
      name: 'falls through to the auth form for signed-out planner auth',
      override: {},
    },
  ] satisfies Array<{
    expected: AuthGateView
    name: string
    override: Partial<ResolveAuthGateViewInput>
  }>)('$name', ({ expected, override }) => {
    expect(resolveAuthGateView({ ...DEFAULT_INPUT, ...override })).toEqual(
      expected,
    )
  })
})
