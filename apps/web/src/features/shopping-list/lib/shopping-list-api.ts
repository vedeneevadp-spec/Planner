import {
  apiErrorSchema,
  chaosInboxCreatedRecordResponseSchema,
  type ChaosInboxItemRecord,
  chaosInboxItemRecordSchema,
  type ChaosInboxItemUpdateInput,
  chaosInboxItemUpdateInputSchema,
  chaosInboxListRecordResponseSchema,
  createChaosInboxItemsInputSchema,
  generateUuidV7,
} from '@planner/contracts'

type FetchFn = typeof fetch
type RequestSignal = AbortSignal | undefined

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
  const baseUrl = config.apiBaseUrl.replace(/\/$/, '')

  async function request<TResponse>(options: {
    body?: unknown
    method?: 'GET' | 'PATCH' | 'POST'
    path: string
    query?: Record<string, string | number | undefined> | undefined
    responseSchema: { parse: (value: unknown) => TResponse }
    signal?: RequestSignal
    writeAccess?: boolean
  }): Promise<TResponse> {
    const response = await sendRequest(options)
    const payload = await readResponsePayload(response)

    if (!response.ok) {
      throwApiError(response, payload)
    }

    return options.responseSchema.parse(payload)
  }

  async function requestVoid(options: {
    method: 'DELETE'
    path: string
    writeAccess?: boolean
  }): Promise<void> {
    const response = await sendRequest(options)
    const payload = await readResponsePayload(response)

    if (!response.ok) {
      throwApiError(response, payload)
    }
  }

  async function sendRequest(options: {
    body?: unknown
    method?: 'DELETE' | 'GET' | 'PATCH' | 'POST'
    path: string
    query?: Record<string, string | number | undefined> | undefined
    signal?: RequestSignal
    writeAccess?: boolean
  }): Promise<Response> {
    const url = new URL(`${baseUrl}${options.path}`)

    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined) {
          continue
        }

        url.searchParams.set(key, String(value))
      }
    }

    const headers = new Headers({
      'x-workspace-id': config.workspaceId,
    })

    if (config.accessToken) {
      headers.set('authorization', `Bearer ${config.accessToken}`)
    }

    if (options.writeAccess && !config.accessToken) {
      headers.set('x-actor-user-id', config.actorUserId)
    }

    if (options.body !== undefined) {
      headers.set('content-type', 'application/json')
    }

    return fetchFn(url, {
      body: options.body === undefined ? null : JSON.stringify(options.body),
      headers,
      method: options.method ?? 'GET',
      ...(options.signal ? { signal: options.signal } : {}),
    })
  }

  async function readResponsePayload(response: Response): Promise<unknown> {
    const text = await response.text()

    if (!text) {
      return undefined
    }

    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  }

  function throwApiError(response: Response, payload: unknown): never {
    const parsedError = apiErrorSchema.safeParse(payload)

    if (parsedError.success) {
      throw new ShoppingListApiError(parsedError.data.error.message, {
        code: parsedError.data.error.code,
        details: parsedError.data.error.details,
        status: response.status,
      })
    }

    throw new ShoppingListApiError('Request failed.', {
      code: 'request_failed',
      details: payload,
      status: response.status,
    })
  }

  return {
    async createItem(input) {
      const itemInput = normalizeCreateItemInput(input)
      const validatedInput = createChaosInboxItemsInputSchema.parse({
        items: [
          {
            id: itemInput.id ?? generateUuidV7(),
            kind: 'shopping',
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
      return requestVoid({
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
