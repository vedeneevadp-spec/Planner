import { describe, expect, it } from 'vitest'

import {
  assertCanUseProtectedSessionApi,
  canUseProtectedSessionApi,
  resolveSessionAuthLifecycleStatus,
} from './session-auth-lifecycle'

describe('session auth lifecycle', () => {
  it('marks disabled auth as a separate non-restoring lifecycle', () => {
    expect(
      resolveSessionAuthLifecycleStatus({
        accessToken: null,
        email: null,
        isAuthEnabled: false,
        isLoading: true,
        userId: null,
      }),
    ).toBe('disabled')
  })

  it('keeps restoring ahead of cached identity state', () => {
    expect(
      resolveSessionAuthLifecycleStatus({
        accessToken: null,
        email: 'mobile@example.com',
        isAuthEnabled: true,
        isLoading: true,
        userId: 'user-1',
      }),
    ).toBe('restoring')
  })

  it('distinguishes usable auth from deferred device identity', () => {
    expect(
      resolveSessionAuthLifecycleStatus({
        accessToken: 'access-token',
        email: 'mobile@example.com',
        isAuthEnabled: true,
        isLoading: false,
        userId: 'user-1',
      }),
    ).toBe('authenticated')

    expect(
      resolveSessionAuthLifecycleStatus({
        accessToken: null,
        email: 'mobile@example.com',
        isAuthEnabled: true,
        isLoading: false,
        userId: 'user-1',
      }),
    ).toBe('deferred')
  })

  it('treats missing auth identity as signed out only after restore completes', () => {
    expect(
      resolveSessionAuthLifecycleStatus({
        accessToken: null,
        email: null,
        isAuthEnabled: true,
        isLoading: false,
        userId: null,
      }),
    ).toBe('signed_out')
  })

  it('allows protected API calls only when auth is disabled or a token is usable', () => {
    expect(
      canUseProtectedSessionApi({
        accessToken: null,
        isAuthEnabled: false,
      }),
    ).toBe(true)
    expect(
      canUseProtectedSessionApi({
        accessToken: null,
        isAuthEnabled: true,
      }),
    ).toBe(false)
    expect(
      canUseProtectedSessionApi({
        accessToken: 'access-token',
        isAuthEnabled: true,
      }),
    ).toBe(true)
  })

  it('throws before protected writes when auth is deferred', () => {
    expect(() =>
      assertCanUseProtectedSessionApi({ canUseProtectedApi: false }),
    ).toThrow('Auth session is not ready.')
    expect(() =>
      assertCanUseProtectedSessionApi({ canUseProtectedApi: true }),
    ).not.toThrow()
  })
})
