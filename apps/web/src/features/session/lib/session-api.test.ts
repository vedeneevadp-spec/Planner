import { describe, expect, it, vi } from 'vitest'

import { resolvePlannerSession, SessionApiError } from './session-api'

describe('sessionApi', () => {
  it('loads the current session', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          actor: {
            displayName: 'Planner Dev User',
            email: 'dev@planner.local',
            id: 'user-1',
          },
          actorUserId: 'user-1',
          role: 'owner',
          source: 'default',
          workspace: {
            id: 'workspace-1',
            name: 'Personal Workspace',
            slug: 'personal',
          },
          workspaceId: 'workspace-1',
        }),
        { status: 200 },
      ),
    )

    const session = await resolvePlannerSession(fetchMock)

    expect(session.workspace.name).toBe('Personal Workspace')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('forwards abort signal when resolving session', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          actor: {
            displayName: 'Planner Dev User',
            email: 'dev@planner.local',
            id: 'user-1',
          },
          actorUserId: 'user-1',
          role: 'owner',
          source: 'default',
          workspace: {
            id: 'workspace-1',
            name: 'Personal Workspace',
            slug: 'personal',
          },
          workspaceId: 'workspace-1',
        }),
        { status: 200 },
      ),
    )
    const signal = new AbortController().signal

    await resolvePlannerSession(signal, fetchMock)

    const [, requestInit] = fetchMock.mock.calls[0]!

    expect(requestInit?.signal).toBe(signal)
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

    await expect(resolvePlannerSession(fetchMock)).rejects.toThrow(
      SessionApiError,
    )
  })
})
