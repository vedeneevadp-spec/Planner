import type {
  SessionResponse,
  SessionWorkspaceMembership,
} from '@planner/contracts'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearCachedPlannerSession,
  getCachedPlannerSession,
  setCachedPlannerSession,
} from './planner-session-cache'

describe('planner-session-cache', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('stores and restores the cached planner session for an actor', () => {
    const session = createSessionResponse({
      actorUserId: 'user-a',
      role: 'owner',
      workspace: createWorkspace({
        id: 'workspace-a',
        kind: 'personal',
        name: 'User A',
        slug: 'user-a',
      }),
      workspaceId: 'workspace-a',
      workspaces: [
        createWorkspaceMembership({
          id: 'workspace-a',
          kind: 'personal',
          name: 'User A',
          role: 'owner',
          slug: 'user-a',
        }),
      ],
    })

    setCachedPlannerSession(session)

    expect(
      getCachedPlannerSession({
        actorUserId: 'user-a',
      }),
    ).toEqual(session)
  })

  it('adapts the cached session to the selected workspace', () => {
    const session = createSessionResponse({
      actorUserId: 'user-a',
      groupRole: null,
      role: 'owner',
      workspace: createWorkspace({
        id: 'workspace-a',
        kind: 'personal',
        name: 'User A',
        slug: 'user-a',
      }),
      workspaceId: 'workspace-a',
      workspaces: [
        createWorkspaceMembership({
          id: 'workspace-a',
          kind: 'personal',
          name: 'User A',
          role: 'owner',
          slug: 'user-a',
        }),
        createWorkspaceMembership({
          id: 'workspace-b',
          kind: 'shared',
          name: 'Shared B',
          role: 'admin',
          slug: 'shared-b',
        }),
      ],
    })

    setCachedPlannerSession(session)

    expect(
      getCachedPlannerSession({
        actorUserId: 'user-a',
        workspaceId: 'workspace-b',
      }),
    ).toEqual({
      ...session,
      groupRole: null,
      role: 'admin',
      workspace: {
        id: 'workspace-b',
        kind: 'shared',
        name: 'Shared B',
        slug: 'shared-b',
      },
      workspaceId: 'workspace-b',
    })
  })

  it('ignores invalid cached payloads', () => {
    window.localStorage.setItem(
      'planner.cachedSessions',
      JSON.stringify({
        'user-a': {
          actorUserId: 'user-a',
        },
      }),
    )

    expect(
      getCachedPlannerSession({
        actorUserId: 'user-a',
      }),
    ).toBeNull()
  })

  it('clears only the selected actor cache entry', () => {
    setCachedPlannerSession(
      createSessionResponse({
        actorUserId: 'user-a',
        role: 'owner',
        workspace: createWorkspace({
          id: 'workspace-a',
          kind: 'personal',
          name: 'User A',
          slug: 'user-a',
        }),
        workspaceId: 'workspace-a',
        workspaces: [
          createWorkspaceMembership({
            id: 'workspace-a',
            kind: 'personal',
            name: 'User A',
            role: 'owner',
            slug: 'user-a',
          }),
        ],
      }),
    )
    setCachedPlannerSession(
      createSessionResponse({
        actorUserId: 'user-b',
        role: 'owner',
        workspace: createWorkspace({
          id: 'workspace-b',
          kind: 'personal',
          name: 'User B',
          slug: 'user-b',
        }),
        workspaceId: 'workspace-b',
        workspaces: [
          createWorkspaceMembership({
            id: 'workspace-b',
            kind: 'personal',
            name: 'User B',
            role: 'owner',
            slug: 'user-b',
          }),
        ],
      }),
    )

    clearCachedPlannerSession('user-a')

    expect(
      getCachedPlannerSession({
        actorUserId: 'user-a',
      }),
    ).toBeNull()
    expect(
      getCachedPlannerSession({
        actorUserId: 'user-b',
      }),
    ).not.toBeNull()
  })
})

function createSessionResponse(input: {
  actor?: SessionResponse['actor']
  actorUserId: string
  appRole?: SessionResponse['appRole']
  groupRole?: SessionResponse['groupRole']
  role: SessionResponse['role']
  source?: SessionResponse['source']
  workspace: SessionResponse['workspace']
  workspaceId: string
  workspaces: SessionResponse['workspaces']
}): SessionResponse {
  const {
    actor,
    actorUserId,
    appRole = 'user',
    groupRole = null,
    role,
    source = 'access_token',
    workspace,
    workspaceId,
    workspaces,
  } = input

  return {
    actor: actor ?? {
      avatarUrl: null,
      displayName: 'Test User',
      email: 'test@example.com',
      id: actorUserId,
    },
    actorUserId,
    appRole,
    groupRole,
    role,
    source,
    userPreferences: {
      calendarViewMode: 'week',
      energyMode: 'normal',
    },
    workspace,
    workspaceId,
    workspaceSettings: {
      taskCompletionConfettiEnabled: true,
    },
    workspaces,
  }
}

function createWorkspaceMembership(
  input: Pick<
    SessionWorkspaceMembership,
    'id' | 'kind' | 'name' | 'role' | 'slug'
  >,
): SessionWorkspaceMembership {
  return {
    ...input,
    groupRole: null,
  }
}

function createWorkspace(
  input: Pick<SessionResponse['workspace'], 'id' | 'kind' | 'name' | 'slug'>,
): SessionResponse['workspace'] {
  return input
}
