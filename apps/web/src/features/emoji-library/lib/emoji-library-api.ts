import {
  type AddEmojiSetItemsInput,
  addEmojiSetItemsInputSchema,
  emojiSetListResponseSchema,
  type EmojiSetRecord,
  emojiSetRecordSchema,
  generateUuidV7,
  type NewEmojiSetInput,
  newEmojiSetInputSchema,
} from '@planner/contracts'

import {
  type ApiClientFetch,
  type ApiRequestSignal,
  createApiRequester,
} from '@/shared/lib/api-client'

type FetchFn = ApiClientFetch
type RequestSignal = ApiRequestSignal

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
  const { baseUrl, request } = createApiRequester(
    config,
    (message, options) => new EmojiLibraryApiError(message, options),
    fetchFn,
  )

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
      return request<void>({
        method: 'DELETE',
        path: `/api/v1/emoji-sets/${emojiSetId}`,
        writeAccess: true,
      })
    },
    deleteEmojiSetItem(emojiSetId, iconAssetId) {
      return request<void>({
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
