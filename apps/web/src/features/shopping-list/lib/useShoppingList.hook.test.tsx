import 'fake-indexeddb/auto'

import type { ChaosInboxItemRecord, SessionResponse } from '@planner/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { useSessionFeatureReadiness } from '@/features/session'

type SessionFeatureReadinessResult = ReturnType<
  typeof useSessionFeatureReadiness
>

const mocks = vi.hoisted(() => ({
  useSessionFeatureReadiness: vi.fn<() => SessionFeatureReadinessResult>(),
}))

vi.mock('@/features/session', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    useSessionFeatureReadiness: mocks.useSessionFeatureReadiness,
  }
})

import {
  enqueueShoppingListOfflineMutation,
  markShoppingListOfflineMutationConflicted,
  resetShoppingListOfflineDatabaseForTests,
} from './offline-shopping-list-store'
import {
  useCreateShoppingListItem,
  useShoppingListSummary,
  useShoppingListSyncStatus,
} from './useShoppingList'

describe('useShoppingList hooks', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

  beforeEach(async () => {
    await resetShoppingListOfflineDatabaseForTests()
    fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    mocks.useSessionFeatureReadiness.mockReturnValue(
      createFeatureReadinessResult(),
    )
  })

  afterEach(async () => {
    cleanup()
    await resetShoppingListOfflineDatabaseForTests()
    vi.unstubAllGlobals()
    mocks.useSessionFeatureReadiness.mockReset()
  })

  it('loads and summarizes shopping list items through the protected API', async () => {
    const activeItem = createShoppingItemRecord({
      id: 'item-active',
      status: 'new',
      text: 'Молоко',
    })
    const completedItem = createShoppingItemRecord({
      id: 'item-completed',
      status: 'archived',
      text: 'Хлеб',
    })

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [completedItem, activeItem],
        limit: 200,
        page: 1,
        total: 2,
      }),
    )

    const { result } = renderHook(() => useShoppingListSummary(), {
      wrapper: createQueryWrapper(),
    })

    await waitFor(() => {
      expect(result.current.totalItemCount).toBe(2)
    })

    const [url, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init?.headers)

    expect(getRequestUrl(url)).toBe(
      'https://api.chaotika.test/api/v1/chaos-inbox?kind=shopping&limit=200',
    )
    expect(headers.get('authorization')).toBe('Bearer access-token')
    expect(headers.get('x-workspace-id')).toBe('workspace-1')
    expect(result.current.activeItems).toEqual([activeItem])
    expect(result.current.completedItems).toEqual([completedItem])
  })

  it('keeps the shopping query idle when there is no planner session', () => {
    mocks.useSessionFeatureReadiness.mockReturnValue(
      createFeatureReadinessResult({
        apiConfig: null,
        isApiEnabled: false,
        session: undefined,
        workspaceId: 'pending',
      }),
    )

    const { result } = renderHook(() => useShoppingListSummary(), {
      wrapper: createQueryWrapper(),
    })

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.totalItemCount).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates a shopping item with normalized API payload', async () => {
    const createdItem = createShoppingItemRecord({
      id: 'item-created',
      isFavorite: true,
      priority: 'high',
      shoppingCategory: 'groceries',
      text: 'Сыр',
    })

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [createdItem],
      }),
    )

    const { result } = renderHook(() => useCreateShoppingListItem(), {
      wrapper: createQueryWrapper(),
    })

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          isFavorite: true,
          priority: 'high',
          shoppingCategory: 'groceries',
          text: '  сыр  ',
        }),
      ).resolves.toEqual(createdItem)
    })

    const [url, init] = fetchMock.mock.calls[0]!
    const body = parseRequestBody<{
      items: Array<Record<string, unknown>>
    }>(init)

    expect(getRequestUrl(url)).toBe(
      'https://api.chaotika.test/api/v1/chaos-inbox',
    )
    expect(init?.method).toBe('POST')
    expect(body.items[0]).toMatchObject({
      isFavorite: true,
      kind: 'shopping',
      priority: 'high',
      shoppingCategory: 'groceries',
      source: 'manual',
      text: 'Сыр',
    })
    expect(typeof body.items[0]?.id).toBe('string')
  })

  it('does not create a duplicate active shopping item', async () => {
    const activeItem = createShoppingItemRecord({
      id: 'item-active',
      status: 'new',
      text: 'Молоко',
    })

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [activeItem],
        limit: 200,
        page: 1,
        total: 1,
      }),
    )

    const { result } = renderHook(
      () => ({
        createItem: useCreateShoppingListItem(),
        summary: useShoppingListSummary(),
      }),
      {
        wrapper: createQueryWrapper(),
      },
    )

    await waitFor(() => {
      expect(result.current.summary.totalItemCount).toBe(1)
    })

    await act(async () => {
      await expect(
        result.current.createItem.mutateAsync('молоко'),
      ).resolves.toEqual(activeItem)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports pending and conflicted shopping offline mutations', async () => {
    await enqueueShoppingListOfflineMutation({
      actorUserId: 'user-1',
      itemId: 'item-pending',
      text: 'Молоко',
      type: 'shopping.create',
      workspaceId: 'workspace-1',
    })
    const conflictedMutation = await enqueueShoppingListOfflineMutation({
      actorUserId: 'user-1',
      itemId: 'item-conflicted',
      type: 'shopping.delete',
      workspaceId: 'workspace-1',
    })

    if (!conflictedMutation) {
      throw new Error('Expected offline shopping mutation to be queued.')
    }

    await markShoppingListOfflineMutationConflicted(
      conflictedMutation.id,
      'Item no longer exists.',
    )

    const { result } = renderHook(() => useShoppingListSyncStatus(), {
      wrapper: createQueryWrapper(),
    })

    await waitFor(() => {
      expect(result.current.queuedMutationCount).toBe(1)
      expect(result.current.conflictedMutationCount).toBe(1)
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reactivates a completed duplicate shopping item', async () => {
    const completedItem = createShoppingItemRecord({
      id: 'item-completed',
      status: 'archived',
      text: 'Хлеб',
    })
    const reactivatedItem = {
      ...completedItem,
      status: 'new' as const,
      version: completedItem.version + 1,
    }

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [completedItem],
          limit: 200,
          page: 1,
          total: 1,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(reactivatedItem))

    const { result } = renderHook(
      () => ({
        createItem: useCreateShoppingListItem(),
        summary: useShoppingListSummary(),
      }),
      {
        wrapper: createQueryWrapper(),
      },
    )

    await waitFor(() => {
      expect(result.current.summary.totalItemCount).toBe(1)
    })

    await act(async () => {
      await expect(
        result.current.createItem.mutateAsync('хлеб'),
      ).resolves.toEqual(reactivatedItem)
    })

    const [url, init] = fetchMock.mock.calls[1]!
    const body = parseRequestBody<Record<string, unknown>>(init)

    expect(getRequestUrl(url)).toBe(
      'https://api.chaotika.test/api/v1/chaos-inbox/item-completed',
    )
    expect(init?.method).toBe('PATCH')
    expect(body).toEqual({ status: 'new' })
  })
})

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        retry: false,
      },
    },
  })

  function TestQueryWrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }

  return TestQueryWrapper
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json',
    },
    status: 200,
  })
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  return input.url
}

function parseRequestBody<T>(init: RequestInit | undefined): T {
  const body = init?.body

  if (typeof body !== 'string') {
    throw new Error('Expected string request body.')
  }

  return JSON.parse(body) as T
}

function createFeatureReadinessResult(
  overrides: Partial<SessionFeatureReadinessResult> = {},
): SessionFeatureReadinessResult {
  const session = createSessionResponse()

  return {
    apiConfig: {
      accessToken: 'access-token',
      actorUserId: session.actorUserId,
      apiBaseUrl: 'https://api.chaotika.test',
      workspaceId: session.workspaceId,
    },
    getReadiness: () => ({
      canReadCachedData: true,
      canRenderAppContent: true,
      canUseProtectedApi: true,
      canWriteProtectedData: true,
      reason: 'ready',
      status: 'ready',
    }),
    isApiEnabled: true,
    readiness: {
      canReadCachedData: true,
      canRenderAppContent: true,
      canUseProtectedApi: true,
      canWriteProtectedData: true,
      reason: 'ready',
      status: 'ready',
    },
    session,
    sessionQuery: {} as SessionFeatureReadinessResult['sessionQuery'],
    workspaceId: session.workspaceId,
    ...overrides,
  }
}

function createSessionResponse(): SessionResponse {
  return {
    actor: {
      avatarUrl: null,
      displayName: 'Planner User',
      email: 'user@example.test',
      id: 'user-1',
    },
    actorUserId: 'user-1',
    appRole: 'user',
    groupRole: null,
    role: 'owner',
    source: 'access_token',
    userPreferences: {
      calendarViewMode: 'week',
      defaultTimeZone: null,
      energyMode: 'normal',
      lastSeenTimeZone: null,
      timeZoneMode: 'device',
      voiceAssistantEnabled: true,
    },
    workspace: {
      id: 'workspace-1',
      kind: 'personal',
      name: 'Planner Workspace',
      slug: 'planner-workspace',
    },
    workspaceId: 'workspace-1',
    workspaceSettings: {
      defaultTimeZone: null,
      taskCompletionConfettiEnabled: true,
      wakeWordTrainingModeEnabled: false,
    },
    workspaces: [
      {
        groupRole: null,
        id: 'workspace-1',
        kind: 'personal',
        name: 'Planner Workspace',
        role: 'owner',
        slug: 'planner-workspace',
      },
    ],
  }
}

function createShoppingItemRecord(
  overrides: Pick<ChaosInboxItemRecord, 'id' | 'text'> &
    Partial<ChaosInboxItemRecord>,
): ChaosInboxItemRecord {
  const { id, text, ...rest } = overrides

  return {
    convertedNoteId: null,
    convertedTaskId: null,
    createdAt: '2026-05-26T00:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    id,
    isFavorite: false,
    kind: 'shopping',
    linkedTaskDeleted: false,
    priority: null,
    shoppingCategory: 'other',
    source: 'manual',
    sphereId: null,
    status: 'new',
    text,
    updatedAt: '2026-05-26T00:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
    ...rest,
  }
}
