import { describe, expect, it } from 'vitest'

import type { PlannerApiConfig } from '@/shared/config/planner-api'

import {
  canBootstrapPlannerSession,
  hasLegacyPlannerSessionOverrides,
} from './session-bootstrap'

const BASE_CONFIG: PlannerApiConfig = {
  apiBaseUrl: 'https://chaotika.ru',
}

describe('session bootstrap', () => {
  it('requires an access token when browser auth is enabled', () => {
    expect(
      canBootstrapPlannerSession({
        accessToken: null,
        config: BASE_CONFIG,
        isAuthEnabled: true,
      }),
    ).toBe(false)

    expect(
      canBootstrapPlannerSession({
        accessToken: 'token-1',
        config: BASE_CONFIG,
        isAuthEnabled: true,
      }),
    ).toBe(true)
  })

  it('accepts legacy workspace overrides when browser auth is disabled', () => {
    const config: PlannerApiConfig = {
      ...BASE_CONFIG,
      actorUserIdOverride: 'user-1',
      workspaceIdOverride: 'workspace-1',
    }

    expect(hasLegacyPlannerSessionOverrides(config)).toBe(true)
    expect(
      canBootstrapPlannerSession({
        accessToken: null,
        config,
        isAuthEnabled: false,
      }),
    ).toBe(true)
  })

  it('blocks unauthenticated startup when neither auth nor overrides are configured', () => {
    expect(hasLegacyPlannerSessionOverrides(BASE_CONFIG)).toBe(false)
    expect(
      canBootstrapPlannerSession({
        accessToken: null,
        config: BASE_CONFIG,
        isAuthEnabled: false,
      }),
    ).toBe(false)
  })

  it('still allows disabled-auth mode with an injected API token', () => {
    expect(
      canBootstrapPlannerSession({
        accessToken: 'service-token',
        config: BASE_CONFIG,
        isAuthEnabled: false,
      }),
    ).toBe(true)
  })
})
