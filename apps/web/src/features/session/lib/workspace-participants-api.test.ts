import { describe, expect, it, vi } from 'vitest'

import {
  createWorkspaceParticipantsApiClient,
  WorkspaceParticipantsApiError,
} from './workspace-participants-api'

const API_CONFIG = {
  actorUserId: 'user-1',
  apiBaseUrl: 'https://planner.example',
  workspaceId: 'workspace-1',
} as const

describe('workspaceParticipantsApi', () => {
  it('lists workspace users', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          users: [
            {
              displayName: 'Planner Dev User',
              email: 'dev@planner.local',
              groupRole: 'group_admin',
              id: 'user-1',
              isOwner: true,
              joinedAt: '2026-04-27T12:00:00.000Z',
              membershipId: 'membership-1',
              updatedAt: '2026-04-27T12:00:00.000Z',
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await createWorkspaceParticipantsApiClient(
      API_CONFIG,
      fetchMock,
    ).listWorkspaceUsers()

    expect(result.users).toHaveLength(1)

    const [, requestInit] = fetchMock.mock.calls[0]!
    const headers = new Headers(requestInit?.headers)

    expect(headers.get('x-actor-user-id')).toBe('user-1')
    expect(headers.get('x-workspace-id')).toBe('workspace-1')
  })

  it('creates a workspace invitation', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          email: 'teammate@example.com',
          groupRole: 'group_admin',
          id: 'invitation-1',
          invitedAt: '2026-04-27T12:00:00.000Z',
          updatedAt: '2026-04-27T12:00:00.000Z',
        }),
        { status: 201 },
      ),
    )

    const invitation = await createWorkspaceParticipantsApiClient(
      {
        ...API_CONFIG,
        accessToken: 'access-token',
      },
      fetchMock,
    ).createWorkspaceInvitation({
      email: 'teammate@example.com',
      groupRole: 'group_admin',
    })

    expect(invitation.groupRole).toBe('group_admin')

    const [, requestInit] = fetchMock.mock.calls[0]!
    const headers = new Headers(requestInit?.headers)

    expect(headers.get('authorization')).toBe('Bearer access-token')
    expect(headers.get('content-type')).toBe('application/json')
    expect(requestInit?.method).toBe('POST')
  })

  it('removes a workspace user without requiring a response body', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    )

    await expect(
      createWorkspaceParticipantsApiClient(API_CONFIG, fetchMock).removeWorkspaceUser(
        'membership-1',
      ),
    ).resolves.toBeUndefined()
  })

  it('throws a typed error for failed workspace invitation requests', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'workspace_user_already_exists',
            message: 'Already a participant.',
          },
        }),
        { status: 409 },
      ),
    )

    await expect(
      createWorkspaceParticipantsApiClient(API_CONFIG, fetchMock).createWorkspaceInvitation(
        {
          email: 'teammate@example.com',
          groupRole: 'member',
        },
      ),
    ).rejects.toThrow(WorkspaceParticipantsApiError)
  })
})
