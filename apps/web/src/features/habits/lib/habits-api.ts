import {
  type HabitEntryDeleteInput,
  type HabitEntryRecord,
  habitEntryRecordSchema,
  type HabitEntryUpsertInput,
  habitEntryUpsertInputSchema,
  habitListResponseSchema,
  type HabitRecord,
  habitRecordSchema,
  type HabitStatsResponse,
  habitStatsResponseSchema,
  type HabitTodayResponse,
  habitTodayResponseSchema,
  type HabitUpdateInput,
  habitUpdateInputSchema,
  type NewHabitInput,
  newHabitInputSchema,
} from '@planner/contracts'

import {
  type ApiClientFetch,
  type ApiRequestSignal,
  createApiRequester,
} from '@/shared/lib/api-client'

type FetchFn = ApiClientFetch
type RequestSignal = ApiRequestSignal

export class HabitsApiError extends Error {
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
    this.name = 'HabitsApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export interface HabitsApiClientConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  workspaceId: string
}

export interface HabitsApiClient {
  createHabit: (input: NewHabitInput) => Promise<HabitRecord>
  getStats: (
    from: string,
    to: string,
    signal?: RequestSignal,
  ) => Promise<HabitStatsResponse>
  getToday: (
    date: string,
    signal?: RequestSignal,
  ) => Promise<HabitTodayResponse>
  listHabits: (signal?: RequestSignal) => Promise<HabitRecord[]>
  removeEntry: (
    habitId: string,
    date: string,
    input?: HabitEntryDeleteInput,
  ) => Promise<void>
  removeHabit: (habitId: string) => Promise<void>
  updateHabit: (
    habitId: string,
    input: HabitUpdateInput,
  ) => Promise<HabitRecord>
  upsertEntry: (
    habitId: string,
    date: string,
    input: HabitEntryUpsertInput,
  ) => Promise<HabitEntryRecord>
}

export function createHabitsApiClient(
  config: HabitsApiClientConfig,
  fetchFn: FetchFn = fetch,
): HabitsApiClient {
  const { request } = createApiRequester(
    config,
    (message, options) => new HabitsApiError(message, options),
    fetchFn,
    {
      fallbackErrorCode: 'habit_request_failed',
      fallbackErrorMessage: 'Habit request failed.',
    },
  )

  return {
    createHabit(input) {
      return request({
        body: newHabitInputSchema.parse(input),
        method: 'POST',
        path: '/api/v1/habits',
        responseSchema: habitRecordSchema,
        writeAccess: true,
      })
    },
    getStats(from, to, signal) {
      return request({
        path: '/api/v1/habits/stats',
        query: { from, to },
        responseSchema: habitStatsResponseSchema,
        signal,
      })
    },
    getToday(date, signal) {
      return request({
        path: '/api/v1/habits/today',
        query: { date },
        responseSchema: habitTodayResponseSchema,
        signal,
      })
    },
    listHabits(signal) {
      return request({
        path: '/api/v1/habits',
        responseSchema: habitListResponseSchema,
        signal,
      })
    },
    removeEntry(habitId, date, input = {}) {
      return request<void>({
        body: input,
        method: 'DELETE',
        path: `/api/v1/habits/${encodeURIComponent(habitId)}/entries/${encodeURIComponent(date)}`,
        writeAccess: true,
      })
    },
    removeHabit(habitId) {
      return request<void>({
        method: 'DELETE',
        path: `/api/v1/habits/${encodeURIComponent(habitId)}`,
        writeAccess: true,
      })
    },
    updateHabit(habitId, input) {
      return request({
        body: habitUpdateInputSchema.parse(input),
        method: 'PATCH',
        path: `/api/v1/habits/${encodeURIComponent(habitId)}`,
        responseSchema: habitRecordSchema,
        writeAccess: true,
      })
    },
    upsertEntry(habitId, date, input) {
      return request({
        body: habitEntryUpsertInputSchema.parse(input),
        method: 'PUT',
        path: `/api/v1/habits/${encodeURIComponent(habitId)}/entries/${encodeURIComponent(date)}`,
        responseSchema: habitEntryRecordSchema,
        writeAccess: true,
      })
    },
  }
}
