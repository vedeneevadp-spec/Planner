import { describe, expect, it, vi } from 'vitest'

import { createShoppingListApiClient } from './shopping-list-api'

const TEST_CONFIG = {
  actorUserId: 'user-1',
  apiBaseUrl: 'http://127.0.0.1:3001',
  workspaceId: 'workspace-1',
}

function parseJsonBody(requestInit: RequestInit | undefined): unknown {
  const body = requestInit?.body

  if (typeof body !== 'string') {
    throw new TypeError('Expected request body to be a JSON string.')
  }

  return JSON.parse(body) as unknown
}

describe('shoppingListApi', () => {
  it('loads shopping list items with workspace scoping', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [],
          limit: 200,
          page: 1,
          total: 0,
        }),
        { status: 200 },
      ),
    )
    const api = createShoppingListApiClient(TEST_CONFIG, fetchMock)

    await api.listItems()

    const [url, requestInit] = fetchMock.mock.calls[0]!
    const requestUrl = url instanceof URL ? url.href : url

    expect(requestUrl).toBe(
      'http://127.0.0.1:3001/api/v1/chaos-inbox?kind=shopping&limit=200',
    )
    expect(new Headers(requestInit?.headers).get('x-workspace-id')).toBe(
      'workspace-1',
    )
  })

  it('creates shopping list items with shopping kind', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              convertedNoteId: null,
              convertedTaskId: null,
              createdAt: '2026-05-04T10:00:00.000Z',
              deletedAt: null,
              dueDate: null,
              id: '0196941c-62c1-7d84-9fdb-f5fd1d7540f1',
              kind: 'shopping',
              linkedTaskDeleted: false,
              priority: null,
              source: 'manual',
              sphereId: null,
              status: 'new',
              text: 'Milk',
              updatedAt: '2026-05-04T10:00:00.000Z',
              userId: 'user-1',
              version: 1,
              workspaceId: 'workspace-1',
            },
          ],
        }),
        { status: 201 },
      ),
    )
    const api = createShoppingListApiClient(TEST_CONFIG, fetchMock)

    await api.createItem('Milk')

    const [, requestInit] = fetchMock.mock.calls[0]!
    const body = parseJsonBody(requestInit) as {
      items: Array<{ kind: string; text: string }>
    }

    expect(requestInit?.method).toBe('POST')
    expect(body.items[0]?.kind).toBe('shopping')
    expect(body.items[0]?.text).toBe('Milk')
    expect(new Headers(requestInit?.headers).get('x-actor-user-id')).toBe(
      'user-1',
    )
  })
})
