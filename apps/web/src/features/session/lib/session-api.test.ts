import { describe, expect, it, vi } from 'vitest'

import {
  createSharedWorkspace,
  deleteSharedWorkspace,
  isUnauthorizedSessionApiError,
  resolvePlannerSession,
  SessionApiError,
  updateSharedWorkspace,
  updateUserProfile,
} from './session-api'

function createSessionPayload(source: 'access_token' | 'default' = 'default') {
  return {
    actor: {
      avatarUrl: '/api/v1/profile-assets/user-1.webp',
      displayName: 'Planner Dev User',
      email: 'dev@planner.local',
      id: 'user-1',
    },
    actorUserId: 'user-1',
    appRole: 'owner',
    groupRole: null,
    role: 'owner',
    source,
    workspace: {
      id: 'workspace-1',
      kind: 'personal',
      name: 'Personal Workspace',
      slug: 'personal',
    },
    workspaceId: 'workspace-1',
    workspaceSettings: {
      taskCompletionConfettiEnabled: true,
    },
    workspaces: [
      {
        groupRole: null,
        id: 'workspace-1',
        kind: 'personal',
        name: 'Personal Workspace',
        role: 'owner',
        slug: 'personal',
      },
    ],
  }
}

describe('sessionApi', () => {
  it('loads the current session', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(createSessionPayload()), { status: 200 }),
      )

    const session = await resolvePlannerSession({}, fetchMock)

    expect(session.workspace.name).toBe('Personal Workspace')
    expect(session.actor.avatarUrl).toBe(
      'http://127.0.0.1:3001/api/v1/profile-assets/user-1.webp',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('forwards abort signal when resolving session', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(createSessionPayload()), { status: 200 }),
      )
    const signal = new AbortController().signal

    await resolvePlannerSession(
      {
        signal,
      },
      fetchMock,
    )

    const [, requestInit] = fetchMock.mock.calls[0]!

    expect(requestInit?.signal).toBe(signal)
  })

  it('includes bearer authorization when access token is provided', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(createSessionPayload('access_token')), {
        status: 200,
      }),
    )

    await resolvePlannerSession(
      {
        accessToken: 'planner-access-token',
      },
      fetchMock,
    )

    const [, requestInit] = fetchMock.mock.calls[0]!
    const headers = new Headers(requestInit?.headers)

    expect(headers.get('authorization')).toBe('Bearer planner-access-token')
  })

  it('includes workspace and actor headers for legacy workspace selection', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(createSessionPayload()), { status: 200 }),
      )

    await resolvePlannerSession(
      {
        actorUserId: 'user-1',
        workspaceId: 'workspace-2',
      },
      fetchMock,
    )

    const [, requestInit] = fetchMock.mock.calls[0]!
    const headers = new Headers(requestInit?.headers)

    expect(headers.get('x-actor-user-id')).toBe('user-1')
    expect(headers.get('x-workspace-id')).toBe('workspace-2')
  })

  it('creates a shared workspace', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          groupRole: 'group_admin',
          id: 'workspace-shared',
          kind: 'shared',
          name: 'Shared Workspace 1',
          role: 'owner',
          slug: 'shared-workspace',
        }),
        { status: 201 },
      ),
    )

    const workspace = await createSharedWorkspace(
      {
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
      },
      fetchMock,
    )

    const [, requestInit] = fetchMock.mock.calls[0]!
    const headers = new Headers(requestInit?.headers)
    const body = parseJsonBody(requestInit) as { name?: string }

    expect(workspace.kind).toBe('shared')
    expect(workspace.groupRole).toBe('group_admin')
    expect(body.name).toBeUndefined()
    expect(headers.get('x-actor-user-id')).toBe('user-1')
    expect(headers.get('x-workspace-id')).toBe('workspace-1')
  })

  it('creates a shared workspace with a provided name', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          groupRole: 'group_admin',
          id: 'workspace-shared',
          kind: 'shared',
          name: 'Family Workspace',
          role: 'owner',
          slug: 'family-workspace',
        }),
        { status: 201 },
      ),
    )

    await createSharedWorkspace(
      {
        actorUserId: 'user-1',
        input: {
          name: 'Family Workspace',
        },
        workspaceId: 'workspace-1',
      },
      fetchMock,
    )

    const [, requestInit] = fetchMock.mock.calls[0]!
    const body = parseJsonBody(requestInit) as { name: string }

    expect(body.name).toBe('Family Workspace')
  })

  it('updates a shared workspace name', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          groupRole: 'group_admin',
          id: 'workspace-shared',
          kind: 'shared',
          name: 'Renamed Workspace',
          role: 'owner',
          slug: 'shared-workspace',
        }),
        { status: 200 },
      ),
    )

    const workspace = await updateSharedWorkspace(
      {
        actorUserId: 'user-1',
        input: {
          name: 'Renamed Workspace',
        },
        workspaceId: 'workspace-shared',
      },
      fetchMock,
    )

    const [, requestInit] = fetchMock.mock.calls[0]!
    const headers = new Headers(requestInit?.headers)
    const body = parseJsonBody(requestInit) as { name: string }

    expect(workspace.name).toBe('Renamed Workspace')
    expect(requestInit?.method).toBe('PATCH')
    expect(body.name).toBe('Renamed Workspace')
    expect(headers.get('x-actor-user-id')).toBe('user-1')
    expect(headers.get('x-workspace-id')).toBe('workspace-shared')
  })

  it('updates the current user profile', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          avatarUrl: '/api/v1/profile-assets/user-1-new.webp',
          displayName: 'Planner Captain',
          email: 'dev@planner.local',
          id: 'user-1',
          updatedAt: '2026-05-05T12:00:00.000Z',
        }),
        { status: 200 },
      ),
    )

    const profile = await updateUserProfile(
      {
        actorUserId: 'user-1',
        input: {
          displayName: 'Planner Captain',
        },
        workspaceId: 'workspace-1',
      },
      fetchMock,
    )

    const [, requestInit] = fetchMock.mock.calls[0]!
    const headers = new Headers(requestInit?.headers)
    const body = parseJsonBody(requestInit) as { displayName: string }

    expect(profile.avatarUrl).toBe(
      'http://127.0.0.1:3001/api/v1/profile-assets/user-1-new.webp',
    )
    expect(profile.displayName).toBe('Planner Captain')
    expect(requestInit?.method).toBe('PATCH')
    expect(body.displayName).toBe('Planner Captain')
    expect(headers.get('x-actor-user-id')).toBe('user-1')
    expect(headers.get('x-workspace-id')).toBe('workspace-1')
  })

  it('deletes a shared workspace', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }))

    await deleteSharedWorkspace(
      {
        actorUserId: 'user-1',
        workspaceId: 'workspace-shared',
      },
      fetchMock,
    )

    const [, requestInit] = fetchMock.mock.calls[0]!
    const headers = new Headers(requestInit?.headers)

    expect(requestInit?.method).toBe('DELETE')
    expect(headers.get('x-actor-user-id')).toBe('user-1')
    expect(headers.get('x-workspace-id')).toBe('workspace-shared')
  })

  it('throws typed error on failed resolve', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'session_not_found',
            message: 'No session.',
          },
        }),
        { status: 404 },
      ),
    )

    await expect(resolvePlannerSession({}, fetchMock)).rejects.toThrow(
      SessionApiError,
    )
  })

  it('detects unauthorized session errors', () => {
    const error = new SessionApiError('Unauthorized.', {
      code: 'authentication_required',
      status: 401,
    })

    expect(isUnauthorizedSessionApiError(error)).toBe(true)
    expect(isUnauthorizedSessionApiError(new Error('Network failed.'))).toBe(
      false,
    )
  })
})

function parseJsonBody(requestInit: RequestInit | undefined): unknown {
  const body = requestInit?.body

  if (typeof body !== 'string') {
    throw new Error('Expected request body to be a JSON string.')
  }

  return JSON.parse(body) as unknown
}
