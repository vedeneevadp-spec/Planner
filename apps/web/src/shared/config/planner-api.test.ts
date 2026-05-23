import { describe, expect, it } from 'vitest'

import { resolvePlannerApiConfig } from './planner-api'

describe('planner api config', () => {
  it('allows actor and workspace overrides in local development', () => {
    expect(
      resolvePlannerApiConfig({
        DEV: true,
        MODE: 'development',
        VITE_ACTOR_USER_ID: 'user-1',
        VITE_API_BASE_URL: 'http://127.0.0.1:3001',
        VITE_WORKSPACE_ID: 'workspace-1',
      }),
    ).toMatchObject({
      actorUserIdOverride: 'user-1',
      workspaceIdOverride: 'workspace-1',
    })
  })

  it('rejects actor and workspace overrides outside dev and test builds', () => {
    expect(() =>
      resolvePlannerApiConfig({
        DEV: false,
        MODE: 'production',
        VITE_ACTOR_USER_ID: 'user-1',
        VITE_API_BASE_URL: 'https://chaotika.ru',
        VITE_WORKSPACE_ID: 'workspace-1',
      }),
    ).toThrow('VITE_ACTOR_USER_ID is supported only')
  })
})
