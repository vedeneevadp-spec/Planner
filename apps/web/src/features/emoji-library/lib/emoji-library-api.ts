import {
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
  createEmojiSet: (input: NewEmojiSetInput) => Promise<EmojiSetRecord>
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

    const response = await fetchFn(`${baseUrl}${options.path}`, {
      body: options.body === undefined ? null : JSON.stringify(options.body),
      headers,
      method: options.method ?? 'GET',
      ...(options.signal ? { signal: options.signal } : {}),
    })
    const payload = (await response.json()) as unknown

    if (!response.ok) {
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

    return options.responseSchema.parse(payload)
  }

  return {
    async createEmojiSet(input) {
      const validatedInput = newEmojiSetInputSchema.parse({
        ...input,
        id: input.id ?? generateUuidV7(),
        items: input.items.map((item) => ({
          ...item,
          id: item.id ?? generateUuidV7(),
        })),
      })

      return request({
        body: validatedInput,
        method: 'POST',
        path: '/api/v1/emoji-sets',
        responseSchema: emojiSetRecordSchema,
        writeAccess: true,
      })
    },
    async listEmojiSets(signal) {
      return request({
        path: '/api/v1/emoji-sets',
        responseSchema: emojiSetListResponseSchema,
        signal,
      })
    },
  }
}
