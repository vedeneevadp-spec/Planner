import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  refreshAuthSession,
  signInWithPassword,
  signOutAuthSession,
  updatePassword,
} from './auth-api'

describe('auth-api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses cookie refresh transport for browser auth requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        accessToken: 'access-token',
        expiresAt: '2026-04-20T09:00:00.000Z',
        user: {
          email: 'web@example.test',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await signInWithPassword({
      email: 'web@example.test',
      password: 'password',
    })

    expect(response.refreshToken).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
      }),
    )
  })

  it('requests body refresh tokens only for native auth clients', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        accessToken: 'access-token',
        expiresAt: '2026-04-20T09:00:00.000Z',
        refreshToken: 'refresh-token',
        user: {
          email: 'native@example.test',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await signInWithPassword(
      {
        email: 'native@example.test',
        password: 'password',
      },
      {
        tokenTransport: 'body',
        rememberSession: false,
      },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-auth-session-persistence': 'session',
          'x-auth-token-transport': 'body',
        },
      }),
    )
  })

  it('can refresh and sign out through the HttpOnly cookie without a body token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: 'access-token',
          expiresAt: '2026-04-20T09:00:00.000Z',
          user: {
            email: 'web@example.test',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await refreshAuthSession()
    await signOutAuthSession()

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.any(URL),
      expect.objectContaining({
        body: '{}',
        credentials: 'include',
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.any(URL),
      expect.objectContaining({
        body: '{}',
        credentials: 'include',
        method: 'POST',
      }),
    )
  })

  it('returns a fresh session when updating the password', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        accessToken: 'next-access-token',
        expiresAt: '2026-04-20T09:00:00.000Z',
        refreshToken: 'next-refresh-token',
        user: {
          email: 'native@example.test',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await updatePassword(
      {
        currentPassword: 'old-password',
        password: 'new-password',
      },
      'current-access-token',
      {
        tokenTransport: 'body',
      },
    )

    expect(response.refreshToken).toBe('next-refresh-token')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        credentials: 'include',
        headers: {
          authorization: 'Bearer current-access-token',
          'content-type': 'application/json',
          'x-auth-token-transport': 'body',
        },
        method: 'PATCH',
      }),
    )
  })
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json',
    },
    status,
  })
}
