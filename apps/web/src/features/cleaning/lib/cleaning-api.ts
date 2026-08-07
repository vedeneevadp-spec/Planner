import {
  type CleaningListResponse,
  cleaningListResponseSchema,
  type CleaningSeedInput,
  cleaningSeedInputSchema,
  type CleaningTaskActionInput,
  cleaningTaskActionInputSchema,
  type CleaningTaskActionResponse,
  cleaningTaskActionResponseSchema,
  cleaningTaskDeleteInputSchema,
  type CleaningTaskRecord,
  cleaningTaskRecordSchema,
  type CleaningTaskUpdateInput,
  cleaningTaskUpdateInputSchema,
  type CleaningTodayResponse,
  cleaningTodayResponseSchema,
  cleaningZoneDeleteInputSchema,
  type CleaningZoneRecord,
  cleaningZoneRecordSchema,
  type CleaningZoneUpdateInput,
  cleaningZoneUpdateInputSchema,
  generateUuidV7,
  type NewCleaningTaskInput,
  newCleaningTaskInputSchema,
  type NewCleaningZoneInput,
  newCleaningZoneInputSchema,
} from '@planner/contracts'

import {
  type ApiClientFetch,
  type ApiRequestSignal,
  createApiRequester,
} from '@/shared/lib/api-client'

type FetchFn = ApiClientFetch
type RequestSignal = ApiRequestSignal

export class CleaningApiError extends Error {
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
    this.name = 'CleaningApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export interface CleaningApiClientConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  workspaceId: string
}

export interface CleaningWriteOptions {
  operationId?: string | undefined
}

export interface CleaningDeleteOptions extends CleaningWriteOptions {
  expectedVersion?: number | undefined
}

export interface CleaningZoneDeleteOptions extends CleaningDeleteOptions {
  expectedTaskVersions?: Array<{ taskId: string; version: number }> | undefined
}

export interface CleaningApiClient {
  completeTask: (
    taskId: string,
    input?: CleaningTaskActionInput,
    options?: CleaningWriteOptions,
  ) => Promise<CleaningTaskActionResponse>
  createTask: (
    input: NewCleaningTaskInput,
    options?: CleaningWriteOptions,
  ) => Promise<CleaningTaskRecord>
  createZone: (
    input: NewCleaningZoneInput,
    options?: CleaningWriteOptions,
  ) => Promise<CleaningZoneRecord>
  getToday: (
    date: string,
    signal?: RequestSignal,
  ) => Promise<CleaningTodayResponse>
  listCleaning: (signal?: RequestSignal) => Promise<CleaningListResponse>
  postponeTask: (
    taskId: string,
    input?: CleaningTaskActionInput,
    options?: CleaningWriteOptions,
  ) => Promise<CleaningTaskActionResponse>
  removeTask: (taskId: string, options?: CleaningDeleteOptions) => Promise<void>
  removeZone: (
    zoneId: string,
    options?: CleaningZoneDeleteOptions,
  ) => Promise<void>
  seed: (
    input: CleaningSeedInput,
    options?: CleaningWriteOptions,
  ) => Promise<CleaningListResponse>
  skipTask: (
    taskId: string,
    input?: CleaningTaskActionInput,
    options?: CleaningWriteOptions,
  ) => Promise<CleaningTaskActionResponse>
  updateTask: (
    taskId: string,
    input: CleaningTaskUpdateInput,
    options?: CleaningWriteOptions,
  ) => Promise<CleaningTaskRecord>
  updateZone: (
    zoneId: string,
    input: CleaningZoneUpdateInput,
    options?: CleaningWriteOptions,
  ) => Promise<CleaningZoneRecord>
}

export function createCleaningApiClient(
  config: CleaningApiClientConfig,
  fetchFn: FetchFn = fetch,
): CleaningApiClient {
  const { request } = createApiRequester(
    config,
    (message, options) => new CleaningApiError(message, options),
    fetchFn,
    {
      fallbackErrorCode: 'cleaning_request_failed',
      fallbackErrorMessage: 'Cleaning request failed.',
    },
  )

  return {
    completeTask(taskId, input = createDefaultActionInput(), options) {
      return request({
        body: cleaningTaskActionInputSchema.parse(input),
        headers: createOperationHeaders(options),
        method: 'POST',
        path: `/api/v1/cleaning/tasks/${encodeURIComponent(taskId)}/complete`,
        responseSchema: cleaningTaskActionResponseSchema,
        writeAccess: true,
      })
    },
    createTask(input, options) {
      return request({
        body: newCleaningTaskInputSchema.parse(input),
        headers: createOperationHeaders(options),
        method: 'POST',
        path: '/api/v1/cleaning/tasks',
        responseSchema: cleaningTaskRecordSchema,
        writeAccess: true,
      })
    },
    createZone(input, options) {
      return request({
        body: newCleaningZoneInputSchema.parse(input),
        headers: createOperationHeaders(options),
        method: 'POST',
        path: '/api/v1/cleaning/zones',
        responseSchema: cleaningZoneRecordSchema,
        writeAccess: true,
      })
    },
    getToday(date, signal) {
      return request({
        path: '/api/v1/cleaning/today',
        query: { date },
        responseSchema: cleaningTodayResponseSchema,
        signal,
      })
    },
    listCleaning(signal) {
      return request({
        path: '/api/v1/cleaning',
        responseSchema: cleaningListResponseSchema,
        signal,
      })
    },
    postponeTask(taskId, input = createDefaultActionInput(), options) {
      return request({
        body: cleaningTaskActionInputSchema.parse(input),
        headers: createOperationHeaders(options),
        method: 'POST',
        path: `/api/v1/cleaning/tasks/${encodeURIComponent(taskId)}/postpone`,
        responseSchema: cleaningTaskActionResponseSchema,
        writeAccess: true,
      })
    },
    removeTask(taskId, options) {
      return request<void>({
        body: cleaningTaskDeleteInputSchema.parse({
          expectedVersion: options?.expectedVersion,
        }),
        headers: createOperationHeaders(options),
        method: 'DELETE',
        path: `/api/v1/cleaning/tasks/${encodeURIComponent(taskId)}`,
        writeAccess: true,
      })
    },
    removeZone(zoneId, options) {
      return request<void>({
        body: cleaningZoneDeleteInputSchema.parse({
          expectedTaskVersions: options?.expectedTaskVersions,
          expectedVersion: options?.expectedVersion,
        }),
        headers: createOperationHeaders(options),
        method: 'DELETE',
        path: `/api/v1/cleaning/zones/${encodeURIComponent(zoneId)}`,
        writeAccess: true,
      })
    },
    seed(input, options) {
      return request({
        body: cleaningSeedInputSchema.parse(input),
        headers: createOperationHeaders(options),
        method: 'POST',
        path: '/api/v1/cleaning/seed',
        responseSchema: cleaningListResponseSchema,
        writeAccess: true,
      })
    },
    skipTask(taskId, input = createDefaultActionInput(), options) {
      return request({
        body: cleaningTaskActionInputSchema.parse(input),
        headers: createOperationHeaders(options),
        method: 'POST',
        path: `/api/v1/cleaning/tasks/${encodeURIComponent(taskId)}/skip`,
        responseSchema: cleaningTaskActionResponseSchema,
        writeAccess: true,
      })
    },
    updateTask(taskId, input, options) {
      return request({
        body: cleaningTaskUpdateInputSchema.parse(input),
        headers: createOperationHeaders(options),
        method: 'PATCH',
        path: `/api/v1/cleaning/tasks/${encodeURIComponent(taskId)}`,
        responseSchema: cleaningTaskRecordSchema,
        writeAccess: true,
      })
    },
    updateZone(zoneId, input, options) {
      return request({
        body: cleaningZoneUpdateInputSchema.parse(input),
        headers: createOperationHeaders(options),
        method: 'PATCH',
        path: `/api/v1/cleaning/zones/${encodeURIComponent(zoneId)}`,
        responseSchema: cleaningZoneRecordSchema,
        writeAccess: true,
      })
    },
  }
}

function createOperationHeaders(options?: CleaningWriteOptions): HeadersInit {
  return {
    'idempotency-key': options?.operationId ?? generateUuidV7(),
  }
}

function createDefaultActionInput(): CleaningTaskActionInput {
  return {
    mode: 'next_cycle',
    note: '',
    targetDate: null,
  }
}
