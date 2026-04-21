import { isUuidV7 } from '@planner/contracts'
import { describe, expect, it, vi } from 'vitest'

import { createEmojiLibraryApiClient } from './emoji-library-api'

const TEST_CONFIG = {
  actorUserId: 'user-1',
  apiBaseUrl: 'http://127.0.0.1:3001',
  workspaceId: 'workspace-1',
}

function parseJsonRequestBody<T>(requestInit: RequestInit | undefined): T {
  const body = requestInit?.body

  if (typeof body !== 'string') {
    throw new TypeError('Expected request body to be a JSON string.')
  }

  return JSON.parse(body) as T
}

describe('emojiLibraryApi', () => {
  it('lists emoji sets with workspace header', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
      }),
    )
    const api = createEmojiLibraryApiClient(TEST_CONFIG, fetchMock)

    const emojiSets = await api.listEmojiSets()

    expect(emojiSets).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, requestInit] = fetchMock.mock.calls[0]!

    expect(url).toBe('http://127.0.0.1:3001/api/v1/emoji-sets')
    expect(new Headers(requestInit?.headers).get('x-workspace-id')).toBe(
      'workspace-1',
    )
    expect(new Headers(requestInit?.headers).get('x-actor-user-id')).toBeNull()
  })

  it('creates emoji sets with stable generated ids', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          createdAt: '2026-04-21T04:00:00.000Z',
          deletedAt: null,
          description: '',
          id: '01975dc4-0000-7000-8000-000000000001',
          items: [
            {
              createdAt: '2026-04-21T04:00:00.000Z',
              deletedAt: null,
              emojiSetId: '01975dc4-0000-7000-8000-000000000001',
              id: '01975dc4-0000-7000-8000-000000000002',
              keywords: [],
              kind: 'unicode',
              label: 'Focus',
              shortcode: 'focus',
              sortOrder: 0,
              updatedAt: '2026-04-21T04:00:00.000Z',
              value: '🎯',
              version: 1,
              workspaceId: 'workspace-1',
            },
          ],
          source: 'telegram',
          status: 'active',
          title: 'Telegram Planner',
          updatedAt: '2026-04-21T04:00:00.000Z',
          version: 1,
          workspaceId: 'workspace-1',
        }),
        {
          status: 201,
        },
      ),
    )
    const api = createEmojiLibraryApiClient(TEST_CONFIG, fetchMock)

    await api.createEmojiSet({
      description: '',
      items: [
        {
          kind: 'unicode',
          label: 'Focus',
          shortcode: 'focus',
          value: '🎯',
        },
      ],
      source: 'telegram',
      title: 'Telegram Planner',
    })

    const [url, requestInit] = fetchMock.mock.calls[0]!
    const body = parseJsonRequestBody<{
      id: string
      items: Array<{ id: string }>
    }>(requestInit)

    expect(url).toBe('http://127.0.0.1:3001/api/v1/emoji-sets')
    expect(isUuidV7(body.id)).toBe(true)
    expect(isUuidV7(body.items[0]!.id)).toBe(true)
    expect(new Headers(requestInit?.headers).get('x-actor-user-id')).toBe(
      'user-1',
    )
  })
})
