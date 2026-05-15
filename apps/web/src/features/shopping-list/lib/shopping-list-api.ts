import {
  chaosInboxCreatedRecordResponseSchema,
  type ChaosInboxItemRecord,
  chaosInboxItemRecordSchema,
  type ChaosInboxItemUpdateInput,
  chaosInboxItemUpdateInputSchema,
  chaosInboxListRecordResponseSchema,
  type ChaosInboxPriority,
  type ChaosInboxShoppingCategory,
  createChaosInboxItemsInputSchema,
  generateUuidV7,
} from '@planner/contracts'

import {
  type ApiClientFetch,
  type ApiRequestSignal,
  createApiRequester,
} from '@/shared/lib/api-client'

type FetchFn = ApiClientFetch
type RequestSignal = ApiRequestSignal

export class ShoppingListApiError extends Error {
  readonly code: string
  readonly details?: unknown
  readonly status: number

  constructor(
    message: string,
    options: {
      code: string
      details?: unknown
      status: number
    },
  ) {
    super(message)
    this.name = 'ShoppingListApiError'
    this.code = options.code
    this.status = options.status

    if ('details' in options) {
      this.details = options.details
    }
  }
}

export interface ShoppingListApiClientConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  workspaceId: string
}

export interface ShoppingListItemCreateInput {
  id?: string
  isFavorite?: boolean
  priority?: ChaosInboxPriority | null
  shoppingCategory?: ChaosInboxShoppingCategory | null
  text: string
}

export interface ShoppingListApiClient {
  createItem: (
    input: string | ShoppingListItemCreateInput,
  ) => Promise<ChaosInboxItemRecord>
  listItems: (signal?: RequestSignal) => Promise<ChaosInboxItemRecord[]>
  removeItem: (itemId: string) => Promise<void>
  updateItem: (
    itemId: string,
    input: ChaosInboxItemUpdateInput,
  ) => Promise<ChaosInboxItemRecord>
}

export function createShoppingListApiClient(
  config: ShoppingListApiClientConfig,
  fetchFn: FetchFn = fetch,
): ShoppingListApiClient {
  const { request } = createApiRequester(
    config,
    (message, options) => new ShoppingListApiError(message, options),
    fetchFn,
  )

  return {
    async createItem(input) {
      const itemInput = normalizeCreateItemInput(input)
      const validatedInput = createChaosInboxItemsInputSchema.parse({
        items: [
          {
            id: itemInput.id ?? generateUuidV7(),
            isFavorite: itemInput.isFavorite ?? false,
            kind: 'shopping',
            priority: itemInput.priority ?? null,
            shoppingCategory: itemInput.shoppingCategory ?? null,
            source: 'manual',
            text: itemInput.text,
          },
        ],
      })
      const response = await request({
        body: validatedInput,
        method: 'POST',
        path: '/api/v1/chaos-inbox',
        responseSchema: chaosInboxCreatedRecordResponseSchema,
        writeAccess: true,
      })

      return response.items[0]!
    },
    async listItems(signal) {
      const response = await request({
        path: '/api/v1/chaos-inbox',
        query: {
          kind: 'shopping',
          limit: 200,
        },
        responseSchema: chaosInboxListRecordResponseSchema,
        signal,
      })

      return response.items
    },
    removeItem(itemId) {
      return request<void>({
        method: 'DELETE',
        path: `/api/v1/chaos-inbox/${encodeURIComponent(itemId)}`,
        writeAccess: true,
      })
    },
    updateItem(itemId, input) {
      const validatedInput = chaosInboxItemUpdateInputSchema.parse(input)

      return request({
        body: validatedInput,
        method: 'PATCH',
        path: `/api/v1/chaos-inbox/${encodeURIComponent(itemId)}`,
        responseSchema: chaosInboxItemRecordSchema,
        writeAccess: true,
      })
    },
  }
}

function normalizeCreateItemInput(
  input: string | ShoppingListItemCreateInput,
): ShoppingListItemCreateInput {
  if (typeof input === 'string') {
    return {
      text: input,
    }
  }

  return input
}
