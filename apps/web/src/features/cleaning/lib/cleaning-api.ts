import {
  type CleaningListResponse,
  cleaningListResponseSchema,
  type CleaningTaskActionInput,
  cleaningTaskActionInputSchema,
  type CleaningTaskActionResponse,
  cleaningTaskActionResponseSchema,
  type CleaningTaskRecord,
  cleaningTaskRecordSchema,
  type CleaningTaskUpdateInput,
  cleaningTaskUpdateInputSchema,
  type CleaningTodayResponse,
  cleaningTodayResponseSchema,
  type CleaningZoneRecord,
  cleaningZoneRecordSchema,
  type CleaningZoneUpdateInput,
  cleaningZoneUpdateInputSchema,
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

export interface CleaningApiClient {
  completeTask: (
    taskId: string,
    input?: CleaningTaskActionInput,
  ) => Promise<CleaningTaskActionResponse>
  createTask: (input: NewCleaningTaskInput) => Promise<CleaningTaskRecord>
  createZone: (input: NewCleaningZoneInput) => Promise<CleaningZoneRecord>
  getToday: (
    date: string,
    signal?: RequestSignal,
  ) => Promise<CleaningTodayResponse>
  listCleaning: (signal?: RequestSignal) => Promise<CleaningListResponse>
  postponeTask: (
    taskId: string,
    input?: CleaningTaskActionInput,
  ) => Promise<CleaningTaskActionResponse>
  removeTask: (taskId: string) => Promise<void>
  removeZone: (zoneId: string) => Promise<void>
  skipTask: (
    taskId: string,
    input?: CleaningTaskActionInput,
  ) => Promise<CleaningTaskActionResponse>
  updateTask: (
    taskId: string,
    input: CleaningTaskUpdateInput,
  ) => Promise<CleaningTaskRecord>
  updateZone: (
    zoneId: string,
    input: CleaningZoneUpdateInput,
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
    completeTask(taskId, input = createDefaultActionInput()) {
      return request({
        body: cleaningTaskActionInputSchema.parse(input),
        method: 'POST',
        path: `/api/v1/cleaning/tasks/${encodeURIComponent(taskId)}/complete`,
        responseSchema: cleaningTaskActionResponseSchema,
        writeAccess: true,
      })
    },
    createTask(input) {
      return request({
        body: newCleaningTaskInputSchema.parse(input),
        method: 'POST',
        path: '/api/v1/cleaning/tasks',
        responseSchema: cleaningTaskRecordSchema,
        writeAccess: true,
      })
    },
    createZone(input) {
      return request({
        body: newCleaningZoneInputSchema.parse(input),
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
    postponeTask(taskId, input = createDefaultActionInput()) {
      return request({
        body: cleaningTaskActionInputSchema.parse(input),
        method: 'POST',
        path: `/api/v1/cleaning/tasks/${encodeURIComponent(taskId)}/postpone`,
        responseSchema: cleaningTaskActionResponseSchema,
        writeAccess: true,
      })
    },
    removeTask(taskId) {
      return request<void>({
        method: 'DELETE',
        path: `/api/v1/cleaning/tasks/${encodeURIComponent(taskId)}`,
        writeAccess: true,
      })
    },
    removeZone(zoneId) {
      return request<void>({
        method: 'DELETE',
        path: `/api/v1/cleaning/zones/${encodeURIComponent(zoneId)}`,
        writeAccess: true,
      })
    },
    skipTask(taskId, input = createDefaultActionInput()) {
      return request({
        body: cleaningTaskActionInputSchema.parse(input),
        method: 'POST',
        path: `/api/v1/cleaning/tasks/${encodeURIComponent(taskId)}/skip`,
        responseSchema: cleaningTaskActionResponseSchema,
        writeAccess: true,
      })
    },
    updateTask(taskId, input) {
      return request({
        body: cleaningTaskUpdateInputSchema.parse(input),
        method: 'PATCH',
        path: `/api/v1/cleaning/tasks/${encodeURIComponent(taskId)}`,
        responseSchema: cleaningTaskRecordSchema,
        writeAccess: true,
      })
    },
    updateZone(zoneId, input) {
      return request({
        body: cleaningZoneUpdateInputSchema.parse(input),
        method: 'PATCH',
        path: `/api/v1/cleaning/zones/${encodeURIComponent(zoneId)}`,
        responseSchema: cleaningZoneRecordSchema,
        writeAccess: true,
      })
    },
  }
}

function createDefaultActionInput(): CleaningTaskActionInput {
  return {
    mode: 'next_cycle',
    note: '',
    targetDate: null,
  }
}
