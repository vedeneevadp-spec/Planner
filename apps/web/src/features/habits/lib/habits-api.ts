import {
  apiErrorSchema,
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

type FetchFn = typeof fetch
type RequestSignal = AbortSignal | undefined

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
  const baseUrl = config.apiBaseUrl.replace(/\/$/, '')

  async function request<TResponse>(options: {
    body?: unknown
    method?: 'GET' | 'PATCH' | 'POST' | 'PUT'
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
    body?: unknown
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
    method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
    path: string
    query?: Record<string, string | number | undefined> | undefined
    signal?: RequestSignal
    writeAccess?: boolean
  }): Promise<Response> {
    const url = new URL(`${baseUrl}${options.path}`)

    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
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
      return requestVoid({
        body: input,
        method: 'DELETE',
        path: `/api/v1/habits/${encodeURIComponent(habitId)}/entries/${encodeURIComponent(date)}`,
        writeAccess: true,
      })
    },
    removeHabit(habitId) {
      return requestVoid({
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
    throw new HabitsApiError(parsedError.data.error.message, {
      code: parsedError.data.error.code,
      details: parsedError.data.error.details,
      status: response.status,
    })
  }

  throw new HabitsApiError('Habit request failed.', {
    code: 'habit_request_failed',
    details: payload,
    status: response.status,
  })
}
