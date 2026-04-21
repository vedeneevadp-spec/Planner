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
  it('lists icon sets with workspace header', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
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
                kind: 'image',
                label: 'Focus',
                shortcode: 'icon-1',
                sortOrder: 0,
                updatedAt: '2026-04-21T04:00:00.000Z',
                value: '/api/v1/icon-assets/focus.png',
                version: 1,
                workspaceId: 'workspace-1',
              },
            ],
            source: 'custom',
            status: 'active',
            title: 'Planner icons',
            updatedAt: '2026-04-21T04:00:00.000Z',
            version: 1,
            workspaceId: 'workspace-1',
          },
        ]),
        {
          status: 200,
        },
      ),
    )
    const api = createEmojiLibraryApiClient(TEST_CONFIG, fetchMock)

    const emojiSets = await api.listEmojiSets()

    expect(emojiSets).toHaveLength(1)
    expect(emojiSets[0]?.items[0]?.value).toBe(
      'http://127.0.0.1:3001/api/v1/icon-assets/focus.png',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, requestInit] = fetchMock.mock.calls[0]!

    expect(url).toBe('http://127.0.0.1:3001/api/v1/emoji-sets')
    expect(new Headers(requestInit?.headers).get('x-workspace-id')).toBe(
      'workspace-1',
    )
    expect(new Headers(requestInit?.headers).get('x-actor-user-id')).toBeNull()
  })

  it('creates icon sets with stable generated ids', async () => {
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
              kind: 'image',
              label: 'Focus',
              shortcode: 'icon-1',
              sortOrder: 0,
              updatedAt: '2026-04-21T04:00:00.000Z',
              value: 'data:image/png;base64,iVBORw0KGgo=',
              version: 1,
              workspaceId: 'workspace-1',
            },
          ],
          source: 'custom',
          status: 'active',
          title: 'Planner icons',
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
          label: 'Focus',
          value: 'data:image/png;base64,iVBORw0KGgo=',
        },
      ],
      title: 'Planner icons',
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

  it('adds icons to an existing set', async () => {
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
              kind: 'image',
              label: 'Archive',
              shortcode: 'icon-2',
              sortOrder: 1,
              updatedAt: '2026-04-21T04:00:00.000Z',
              value: '/api/v1/icon-assets/archive.png',
              version: 1,
              workspaceId: 'workspace-1',
            },
          ],
          source: 'custom',
          status: 'active',
          title: 'Planner icons',
          updatedAt: '2026-04-21T04:00:00.000Z',
          version: 2,
          workspaceId: 'workspace-1',
        }),
        {
          status: 201,
        },
      ),
    )
    const api = createEmojiLibraryApiClient(TEST_CONFIG, fetchMock)

    const emojiSet = await api.addEmojiSetItems(
      '01975dc4-0000-7000-8000-000000000001',
      {
        items: [
          {
            label: 'Archive',
            value: 'data:image/png;base64,iVBORw0KGgo=',
          },
        ],
      },
    )

    const [url, requestInit] = fetchMock.mock.calls[0]!
    const body = parseJsonRequestBody<{
      items: Array<{ id: string }>
    }>(requestInit)

    expect(url).toBe(
      'http://127.0.0.1:3001/api/v1/emoji-sets/01975dc4-0000-7000-8000-000000000001/items',
    )
    expect(isUuidV7(body.items[0]!.id)).toBe(true)
    expect(emojiSet.items[0]?.value).toBe(
      'http://127.0.0.1:3001/api/v1/icon-assets/archive.png',
    )
  })

  it('deletes icon sets and icon items with write headers', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }))
    const api = createEmojiLibraryApiClient(TEST_CONFIG, fetchMock)

    await api.deleteEmojiSet('01975dc4-0000-7000-8000-000000000001')
    await api.deleteEmojiSetItem(
      '01975dc4-0000-7000-8000-000000000001',
      '01975dc4-0000-7000-8000-000000000002',
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [deleteSetUrl, deleteSetInit] = fetchMock.mock.calls[0]!
    const [deleteItemUrl, deleteItemInit] = fetchMock.mock.calls[1]!

    expect(deleteSetUrl).toBe(
      'http://127.0.0.1:3001/api/v1/emoji-sets/01975dc4-0000-7000-8000-000000000001',
    )
    expect(deleteSetInit?.method).toBe('DELETE')
    expect(new Headers(deleteSetInit?.headers).get('x-actor-user-id')).toBe(
      'user-1',
    )
    expect(deleteItemUrl).toBe(
      'http://127.0.0.1:3001/api/v1/emoji-sets/01975dc4-0000-7000-8000-000000000001/items/01975dc4-0000-7000-8000-000000000002',
    )
    expect(deleteItemInit?.method).toBe('DELETE')
    expect(new Headers(deleteItemInit?.headers).get('x-workspace-id')).toBe(
      'workspace-1',
    )
  })
})
