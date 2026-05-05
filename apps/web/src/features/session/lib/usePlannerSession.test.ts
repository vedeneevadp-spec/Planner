import type {
  SessionResponse,
  SessionWorkspaceMembership,
} from '@planner/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionApiError } from './session-api'
import { loadPlannerSession } from './usePlannerSession'
import {
  getLastActorUserId,
  getSelectedWorkspaceId,
  setSelectedWorkspaceId,
} from './workspace-selection'

describe('loadPlannerSession', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('retries without a stale selected workspace after 403', async () => {
    setSelectedWorkspaceId('workspace-a', 'user-a')
    setSelectedWorkspaceId('workspace-stale', 'user-b')

    const session = createSessionResponse({
      actorUserId: 'user-b',
      role: 'owner',
      workspace: createWorkspaceMembership({
        id: 'workspace-b',
        kind: 'personal',
        name: 'User B',
        role: 'owner',
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
    })
    const resolveSession = vi
      .fn()
      .mockRejectedValueOnce(
        new SessionApiError('Forbidden workspace.', {
          code: 'workspace_access_denied',
          status: 403,
        }),
      )
      .mockResolvedValueOnce(session)

    const result = await loadPlannerSession(
      {
        accessToken: 'token',
        legacyActorUserId: 'user-b',
        selectedWorkspaceActorUserId: 'user-b',
        selectedWorkspaceId: 'workspace-stale',
      },
      resolveSession,
    )

    expect(result).toEqual(session)
    expect(resolveSession).toHaveBeenNthCalledWith(1, {
      accessToken: 'token',
      actorUserId: 'user-b',
      signal: undefined,
      workspaceId: 'workspace-stale',
    })
    expect(resolveSession).toHaveBeenNthCalledWith(2, {
      accessToken: 'token',
      actorUserId: 'user-b',
      signal: undefined,
    })
    expect(getSelectedWorkspaceId('user-a')).toBe('workspace-a')
    expect(getSelectedWorkspaceId('user-b')).toBeNull()
    expect(getLastActorUserId()).toBe('user-b')
  })

  it('clears the selected workspace when the resolved session does not contain it', async () => {
    setSelectedWorkspaceId('workspace-stale', 'user-a')

    const session = createSessionResponse({
      actorUserId: 'user-a',
      role: 'admin',
      workspace: createWorkspaceMembership({
        id: 'workspace-b',
        kind: 'shared',
        name: 'Shared B',
        role: 'admin',
        slug: 'shared-b',
      }),
      workspaceId: 'workspace-b',
      workspaces: [
        createWorkspaceMembership({
          id: 'workspace-b',
          kind: 'shared',
          name: 'Shared B',
          role: 'admin',
          slug: 'shared-b',
        }),
      ],
    })
    const resolveSession = vi.fn().mockResolvedValue(session)

    await loadPlannerSession(
      {
        accessToken: 'token',
        legacyActorUserId: 'user-a',
        selectedWorkspaceActorUserId: 'user-a',
        selectedWorkspaceId: 'workspace-stale',
      },
      resolveSession,
    )

    expect(getSelectedWorkspaceId('user-a')).toBeNull()
    expect(getLastActorUserId()).toBe('user-a')
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
