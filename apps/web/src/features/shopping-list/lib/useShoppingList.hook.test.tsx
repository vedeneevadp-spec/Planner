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
  countRetryableShoppingListOfflineMutations,
  enqueueShoppingListOfflineMutation,
  loadCachedShoppingListItems,
  markShoppingListOfflineMutationConflicted,
  replaceCachedShoppingListItems,
  resetShoppingListOfflineDatabaseForTests,
} from './offline-shopping-list-store'
import {
  useCreateShoppingListItem,
  useRemoveShoppingListItem,
  useShoppingListSummary,
  useShoppingListSyncStatus,
  useUpdateShoppingListItem,
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
    vi.restoreAllMocks()
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
    fetchMock.mockImplementationOnce((_url, init) => {
      const body = parseRequestBody<{
        items: Array<{ id: string }>
      }>(init)

      return Promise.resolve(
        jsonResponse({
          items: [
            createShoppingItemRecord({
              id: body.items[0]!.id,
              isFavorite: true,
              priority: 'high',
              shoppingCategory: 'groceries',
              text: 'Сыр',
            }),
          ],
        }),
      )
    })

    const { result } = renderHook(() => useCreateShoppingListItem(), {
      wrapper: createQueryWrapper(),
    })

    let optimisticItem: ChaosInboxItemRecord | undefined

    await act(async () => {
      optimisticItem = await result.current.mutateAsync({
        isFavorite: true,
        priority: 'high',
        shoppingCategory: 'groceries',
        text: '  сыр  ',
      })
    })

    expect(optimisticItem).toMatchObject({
      isFavorite: true,
      priority: 'high',
      shoppingCategory: 'groceries',
      status: 'new',
      text: 'Сыр',
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
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
    expect(body.items[0]?.id).toBe(optimisticItem?.id)
    await waitFor(async () => {
      expect(
        await countRetryableShoppingListOfflineMutations('workspace-1'),
      ).toBe(0)
    })
  })

  it('creates one durable item for concurrent duplicate submissions while offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    const { result } = renderHook(() => useCreateShoppingListItem(), {
      wrapper: createQueryWrapper(),
    })
    let createdItems: ChaosInboxItemRecord[] = []

    await act(async () => {
      createdItems = await Promise.all([
        result.current.mutateAsync('молоко'),
        result.current.mutateAsync('  Молоко  '),
      ])
    })

    expect(createdItems[0]?.id).toBe(createdItems[1]?.id)
    expect(await loadCachedShoppingListItems('workspace-1')).toHaveLength(1)
    expect(
      await countRetryableShoppingListOfflineMutations('workspace-1'),
    ).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(result.current.isPending).toBe(false)
    })
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

  it('optimistically removes an archived item from the active summary', async () => {
    const activeItem = createShoppingItemRecord({
      id: 'item-active',
      status: 'new',
      text: 'Молоко',
    })
    const archivedItem = {
      ...activeItem,
      completedAt: '2026-05-26T01:00:00.000Z',
      status: 'archived' as const,
      version: activeItem.version + 1,
    }
    let resolveUpdateResponse: ((response: Response) => void) | undefined

    fetchMock
      .mockResolvedValue(
        jsonResponse({
          items: [archivedItem],
          limit: 200,
          page: 1,
          total: 1,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [activeItem],
          limit: 200,
          page: 1,
          total: 1,
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveUpdateResponse = resolve
          }),
      )

    const { result } = renderHook(
      () => ({
        summary: useShoppingListSummary(),
        updateItem: useUpdateShoppingListItem(),
      }),
      {
        wrapper: createQueryWrapper(),
      },
    )

    await waitFor(() => {
      expect(result.current.summary.activeItemCount).toBe(1)
    })

    let optimisticItem: ChaosInboxItemRecord | undefined

    await act(async () => {
      optimisticItem = await result.current.updateItem.mutateAsync({
        itemId: activeItem.id,
        patch: {
          priority: null,
          status: 'archived',
        },
      })
    })

    expect(optimisticItem?.status).toBe('archived')
    await waitFor(() => {
      expect(result.current.summary.activeItemCount).toBe(0)
    })
    expect(result.current.updateItem.isPending).toBe(false)

    await waitFor(() => {
      expect(resolveUpdateResponse).toBeTypeOf('function')
    })

    const resolveUpdate = resolveUpdateResponse

    if (!resolveUpdate) {
      throw new Error('Expected the shopping update request to start.')
    }

    act(() => {
      resolveUpdate(jsonResponse(archivedItem))
    })
    await waitFor(async () => {
      expect(
        await countRetryableShoppingListOfflineMutations('workspace-1'),
      ).toBe(0)
    })
  })

  it('updates and removes cached shopping items without waiting for the network while offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    const activeItem = createShoppingItemRecord({
      id: 'item-offline',
      status: 'new',
      text: 'Молоко',
    })
    await replaceCachedShoppingListItems('workspace-1', [activeItem])
    const { queryClient, wrapper } = createQueryHarness()
    queryClient.setQueryData(['shopping-list', 'workspace-1'], [activeItem])
    const { result } = renderHook(
      () => ({
        removeItem: useRemoveShoppingListItem(),
        updateItem: useUpdateShoppingListItem(),
      }),
      { wrapper },
    )

    await act(async () => {
      await expect(
        result.current.updateItem.mutateAsync({
          itemId: activeItem.id,
          patch: { priority: 'high' },
        }),
      ).resolves.toMatchObject({ priority: 'high' })
    })
    expect(
      (await loadCachedShoppingListItems('workspace-1'))[0]?.priority,
    ).toBe('high')

    await act(async () => {
      await Promise.all([
        result.current.removeItem.mutateAsync(activeItem.id),
        result.current.removeItem.mutateAsync(activeItem.id),
      ])
    })

    expect(await loadCachedShoppingListItems('workspace-1')).toEqual([])
    expect(
      await countRetryableShoppingListOfflineMutations('workspace-1'),
    ).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(result.current.removeItem.isPending).toBe(false)
    })
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
      .mockResolvedValue(
        jsonResponse({
          items: [reactivatedItem],
          limit: 200,
          page: 1,
          total: 1,
        }),
      )
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

    let optimisticItem: ChaosInboxItemRecord | undefined

    await act(async () => {
      optimisticItem = await result.current.createItem.mutateAsync('хлеб')
    })

    expect(optimisticItem).toMatchObject({
      id: completedItem.id,
      status: 'new',
    })

    let updateRequest: (typeof fetchMock.mock.calls)[number] | undefined

    await waitFor(() => {
      updateRequest = fetchMock.mock.calls.find(
        ([request, init]) =>
          getRequestUrl(request).endsWith('/item-completed') &&
          init?.method === 'PATCH',
      )
      expect(updateRequest).toBeDefined()
    })

    const [url, init] = updateRequest!
    const body = parseRequestBody<Record<string, unknown>>(init)

    expect(getRequestUrl(url)).toBe(
      'https://api.chaotika.test/api/v1/chaos-inbox/item-completed',
    )
    expect(init?.method).toBe('PATCH')
    expect(body).toEqual({ status: 'new' })
    await waitFor(async () => {
      expect(
        await countRetryableShoppingListOfflineMutations('workspace-1'),
      ).toBe(0)
    })
  })
})

function createQueryWrapper() {
  return createQueryHarness().wrapper
}

function createQueryHarness() {
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

  return {
    queryClient,
    wrapper: TestQueryWrapper,
  }
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
      clientTimeZone: 'Europe/Astrakhan',
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
    activatedAt: '2026-05-26T00:00:00.000Z',
    completedAt: null,
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
