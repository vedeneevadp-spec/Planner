import {
  type AddEmojiSetItemsInput,
  addEmojiSetItemsInputSchema,
  apiErrorSchema,
  emojiSetListResponseSchema,
  type EmojiSetRecord,
  emojiSetRecordSchema,
  generateUuidV7,
  type NewEmojiSetInput,
  newEmojiSetInputSchema,
} from '@planner/contracts'

type FetchFn = typeof fetch
type RequestSignal = AbortSignal | undefined

export class EmojiLibraryApiError extends Error {
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
    this.name = 'EmojiLibraryApiError'
    this.code = options.code
    this.status = options.status

    if ('details' in options) {
      this.details = options.details
    }
  }
}

export interface EmojiLibraryApiClientConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  workspaceId: string
}

export interface EmojiLibraryApiClient {
  addEmojiSetItems: (
    emojiSetId: string,
    input: AddEmojiSetItemsInput,
  ) => Promise<EmojiSetRecord>
  createEmojiSet: (input: NewEmojiSetInput) => Promise<EmojiSetRecord>
  deleteEmojiSet: (emojiSetId: string) => Promise<void>
  deleteEmojiSetItem: (emojiSetId: string, iconAssetId: string) => Promise<void>
  listEmojiSets: (signal?: RequestSignal) => Promise<EmojiSetRecord[]>
}

export function createEmojiLibraryApiClient(
  config: EmojiLibraryApiClientConfig,
  fetchFn: FetchFn = fetch,
): EmojiLibraryApiClient {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, '')

  async function request<TResponse>(options: {
    body?: unknown
    method?: 'GET' | 'POST'
    path: string
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
    signal?: RequestSignal
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
    method?: 'DELETE' | 'GET' | 'POST'
    path: string
    signal?: RequestSignal
    writeAccess?: boolean
  }): Promise<Response> {
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

    return fetchFn(`${baseUrl}${options.path}`, {
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
      throw new EmojiLibraryApiError(parsedError.data.error.message, {
        code: parsedError.data.error.code,
        details: parsedError.data.error.details,
        status: response.status,
      })
    }

    throw new EmojiLibraryApiError('Request failed.', {
      code: 'request_failed',
      details: payload,
      status: response.status,
    })
  }

  return {
    async addEmojiSetItems(emojiSetId, input) {
      const validatedInput = addEmojiSetItemsInputSchema.parse({
        ...input,
        items: input.items.map((item) => ({
          ...item,
          id: item.id ?? generateUuidV7(),
        })),
      })
      const emojiSet = await request({
        body: validatedInput,
        method: 'POST',
        path: `/api/v1/emoji-sets/${emojiSetId}/items`,
        responseSchema: emojiSetRecordSchema,
        writeAccess: true,
      })

      return resolveEmojiSetAssetUrls(emojiSet, baseUrl)
    },
    async createEmojiSet(input) {
      const validatedInput = newEmojiSetInputSchema.parse({
        ...input,
        id: input.id ?? generateUuidV7(),
        items: input.items.map((item) => ({
          ...item,
          id: item.id ?? generateUuidV7(),
        })),
      })

      const emojiSet = await request({
        body: validatedInput,
        method: 'POST',
        path: '/api/v1/emoji-sets',
        responseSchema: emojiSetRecordSchema,
        writeAccess: true,
      })

      return resolveEmojiSetAssetUrls(emojiSet, baseUrl)
    },
    deleteEmojiSet(emojiSetId) {
      return requestVoid({
        method: 'DELETE',
        path: `/api/v1/emoji-sets/${emojiSetId}`,
        writeAccess: true,
      })
    },
    deleteEmojiSetItem(emojiSetId, iconAssetId) {
      return requestVoid({
        method: 'DELETE',
        path: `/api/v1/emoji-sets/${emojiSetId}/items/${iconAssetId}`,
        writeAccess: true,
      })
    },
    async listEmojiSets(signal) {
      const emojiSets = await request({
        path: '/api/v1/emoji-sets',
        responseSchema: emojiSetListResponseSchema,
        signal,
      })

      return emojiSets.map((emojiSet) =>
        resolveEmojiSetAssetUrls(emojiSet, baseUrl),
      )
    },
  }
}

function resolveEmojiSetAssetUrls(
  emojiSet: EmojiSetRecord,
  baseUrl: string,
): EmojiSetRecord {
  return {
    ...emojiSet,
    items: emojiSet.items.map((item) => ({
      ...item,
      value: resolveAssetUrl(item.value, baseUrl),
    })),
  }
}

function resolveAssetUrl(value: string, baseUrl: string): string {
  return value.startsWith('/api/') ? `${baseUrl}${value}` : value
}
