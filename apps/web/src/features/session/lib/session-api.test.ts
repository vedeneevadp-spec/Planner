import { describe, expect, it, vi } from 'vitest'

import {
  createSharedWorkspace,
  isUnauthorizedSessionApiError,
  resolvePlannerSession,
  SessionApiError,
} from './session-api'

function createSessionPayload(source: 'access_token' | 'default' = 'default') {
  return {
    actor: {
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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(createSessionPayload()), { status: 200 }),
    )

    const session = await resolvePlannerSession({}, fetchMock)

    expect(session.workspace.name).toBe('Personal Workspace')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('forwards abort signal when resolving session', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
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

    expect(workspace.kind).toBe('shared')
    expect(workspace.groupRole).toBe('group_admin')
    expect(headers.get('x-actor-user-id')).toBe('user-1')
    expect(headers.get('x-workspace-id')).toBe('workspace-1')
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
