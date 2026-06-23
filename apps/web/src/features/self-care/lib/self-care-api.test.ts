import type {
  SelfCareCompletion,
  SelfCareDashboardResponse,
  SelfCareItem,
  SelfCareListResponse,
  SelfCareOccurrence,
  SelfCareSettingsResponse,
  SelfCareTemplate,
} from '@planner/contracts'
import { describe, expect, it, vi } from 'vitest'

import {
  createSelfCareApiClient,
  type SelfCareApiClientConfig,
  SelfCareApiError,
} from './self-care-api'

const apiConfig: SelfCareApiClientConfig = {
  actorUserId: 'user-1',
  apiBaseUrl: 'https://planner.test/',
  workspaceId: 'workspace-1',
}

describe('createSelfCareApiClient', () => {
  it('serializes read query parameters without write actor headers', async () => {
    const { fetchFn, requests } = createQueuedFetch([
      createListResponse({ items: [createItem()] }),
      [createTemplate()],
      createDashboardResponse(),
    ])
    const client = createSelfCareApiClient(apiConfig, fetchFn)

    await client.listItems({
      category: 'health',
      includeArchived: true,
      type: 'habit',
    })
    await client.listTemplates()
    await client.getDashboard('2026-06-22')

    expect(requests).toHaveLength(3)
    expect(requests[0]?.url.pathname).toBe('/api/v1/self-care')
    expect(requests[0]?.url.searchParams.get('category')).toBe('health')
    expect(requests[0]?.url.searchParams.get('includeArchived')).toBe('true')
    expect(requests[0]?.headers.get('x-workspace-id')).toBe('workspace-1')
    expect(requests[0]?.headers.has('x-actor-user-id')).toBe(false)
    expect(requests[1]?.url.pathname).toBe('/api/v1/self-care/templates')
    expect(requests[2]?.url.searchParams.get('date')).toBe('2026-06-22')
  })

  it('sends validated write bodies with actor headers and supports 204 deletes', async () => {
    const { fetchFn, requests } = createQueuedFetch([
      createItem({ id: 'created-item' }),
      createOccurrence({ id: 'scheduled-occurrence' }),
      undefined,
    ])
    const client = createSelfCareApiClient(apiConfig, fetchFn)

    await client.createItem({
      alternatives: [],
      category: 'health',
      color: null,
      customCategoryId: null,
      defaultDurationMinutes: null,
      description: 'Описание',
      icon: null,
      importance: 'recommended',
      isActive: true,
      isArchived: false,
      isPrivate: true,
      migratedFromHabitId: null,
      preferredTimeOfDay: 'morning',
      steps: [],
      title: 'Новая забота',
      type: 'task',
    })
    await client.scheduleItem('item/with slash', {
      currency: 'RUB',
      note: 'Запись',
      place: 'Клиника',
      price: 1200,
      reminderOffsetsMinutes: [],
      scheduledFor: '2026-06-22',
      scheduledTime: '10:30',
      specialistContact: null,
      specialistName: 'Врач',
      timezone: null,
    })
    await expect(client.deleteItem('created-item')).resolves.toBeUndefined()

    expect(requests[0]?.init.method).toBe('POST')
    expect(requests[0]?.headers.get('x-actor-user-id')).toBe('user-1')
    expect(readJsonBody(requests[0])).toMatchObject({
      title: 'Новая забота',
      type: 'task',
    })
    expect(requests[1]?.url.pathname).toBe(
      '/api/v1/self-care/items/item%2Fwith%20slash/schedule',
    )
    expect(readJsonBody(requests[1])).toMatchObject({
      scheduledFor: '2026-06-22',
      scheduledTime: '10:30',
    })
    expect(requests[2]?.init.method).toBe('DELETE')
  })

  it('covers completion, occurrence, settings, and ritual draft write endpoints', async () => {
    const { fetchFn, requests } = createQueuedFetch([
      createCompletion(),
      createOccurrence({ status: 'moved' }),
      createOccurrence({ status: 'skipped' }),
      createSettingsResponse(),
      createSettingsResponse(),
      createRitualStepDraftResponse(),
      createRitualStepDraftResponse(),
    ])
    const client = createSelfCareApiClient(apiConfig, fetchFn)

    await client.completeOccurrence('occurrence-1', {
      alternativeTitle: null,
      completedVariant: 'full',
      durationMinutes: 15,
      energyAfter: null,
      energyBefore: null,
      measurementUnit: null,
      measurementValue: null,
      moodAfter: null,
      moodBefore: null,
      note: 'Готово',
      status: 'done',
      steps: [{ isDone: true, stepId: 'step-1' }],
    })
    await client.moveOccurrence('occurrence-1', {
      newDate: '2026-06-23',
      note: 'Перенос',
    })
    await client.skipOccurrence('occurrence-1', { reason: 'Не сегодня' })
    await client.updateSettings({
      currency: 'RUB',
      showAppointmentsInCalendar: false,
    })
    await client.updateMinimumItems({
      items: [{ isActive: true, linkedItemId: null, order: 0, title: 'База' }],
    })
    await client.upsertRitualStepDraft({
      date: '2026-06-22',
      itemId: 'ritual-1',
      occurrenceId: null,
      stepIds: ['step-1'],
    })
    await client.deleteRitualStepDraft({
      date: '2026-06-22',
      itemId: 'ritual-1',
      occurrenceId: null,
    })

    expect(requests.map((request) => request.init.method)).toEqual([
      'POST',
      'POST',
      'POST',
      'PATCH',
      'PUT',
      'PUT',
      'DELETE',
    ])
    expect(requests[5]?.url.pathname).toBe(
      '/api/v1/self-care/ritual-step-drafts',
    )
    expect(requests[6]?.url.searchParams.get('occurrenceId')).toBeNull()
  })

  it('maps API error payloads to SelfCareApiError', async () => {
    const { fetchFn } = createQueuedFetch([
      {
        body: {
          error: {
            code: 'self_care_bad_request',
            details: { field: 'title' },
            message: 'Bad self-care request.',
          },
        },
        status: 400,
      },
    ])
    const client = createSelfCareApiClient(apiConfig, fetchFn)

    try {
      await client.listTemplates()
      throw new Error('Expected listTemplates to reject.')
    } catch (error) {
      expect(error).toBeInstanceOf(SelfCareApiError)
      expect(error).toMatchObject({
        code: 'self_care_bad_request',
        details: { field: 'title' },
        message: 'Bad self-care request.',
        status: 400,
      })
    }
  })
})

interface QueuedHttpResponse {
  body: unknown
  status: number
}

interface RecordedRequest {
  headers: Headers
  init: RequestInit
  url: URL
}

function createQueuedFetch(responses: unknown[]) {
  const queue = [...responses]
  const requests: RecordedRequest[] = []
  const fetchFn = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = queue.shift()
      const normalized =
        isQueuedResponseObject(response) && 'status' in response
          ? response
          : { body: response, status: response === undefined ? 204 : 200 }

      requests.push({
        headers: new Headers(init?.headers),
        init: init ?? {},
        url: new URL(getRequestUrl(input)),
      })

      const responseInit: ResponseInit = { status: normalized.status }

      if (normalized.body !== undefined) {
        responseInit.headers = { 'content-type': 'application/json' }
      }

      return Promise.resolve(
        new Response(
          normalized.body === undefined
            ? null
            : JSON.stringify(normalized.body),
          responseInit,
        ),
      )
    },
  )

  return { fetchFn, requests }
}

function isQueuedResponseObject(value: unknown): value is QueuedHttpResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'body' in value &&
    'status' in value
  )
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) {
    return input.href
  }

  if (input instanceof Request) {
    return input.url
  }

  return input
}

function readJsonBody(request: RecordedRequest | undefined): unknown {
  expect(request).toBeDefined()
  const body = request?.init.body

  if (typeof body !== 'string') {
    throw new TypeError('Expected request body to be a JSON string.')
  }

  return JSON.parse(body)
}

function createItem(overrides: Partial<SelfCareItem> = {}): SelfCareItem {
  return {
    category: 'health',
    color: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    createdFromTemplateId: null,
    customCategoryId: null,
    defaultDurationMinutes: null,
    deletedAt: null,
    description: '',
    icon: null,
    id: 'item-1',
    importance: 'recommended',
    isActive: true,
    isArchived: false,
    isPrivate: true,
    migratedFromHabitId: null,
    minimumVersionDescription: null,
    minimumVersionDurationMinutes: null,
    minimumVersionTitle: null,
    preferredTimeOfDay: 'morning',
    title: 'Забота',
    type: 'habit',
    updatedAt: '2026-06-01T00:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

function createOccurrence(
  overrides: Partial<SelfCareOccurrence> = {},
): SelfCareOccurrence {
  return {
    completedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    dueAt: null,
    generatedAt: null,
    id: 'occurrence-1',
    itemId: 'item-1',
    movedTo: null,
    reminderOffsetsMinutes: [],
    reminderTimeZone: null,
    scheduledFor: '2026-06-22',
    scheduleRuleId: 'rule-1',
    status: 'scheduled',
    updatedAt: '2026-06-01T00:00:00.000Z',
    userId: 'user-1',
    ...overrides,
  }
}

function createCompletion(
  overrides: Partial<SelfCareCompletion> = {},
): SelfCareCompletion {
  return {
    alternativeTitle: null,
    completedAt: '2026-06-22T08:00:00.000Z',
    completedVariant: 'full',
    createdAt: '2026-06-22T08:00:00.000Z',
    durationMinutes: null,
    energyAfter: null,
    energyBefore: null,
    id: 'completion-1',
    itemId: 'item-1',
    measurementUnit: null,
    measurementValue: null,
    moodAfter: null,
    moodBefore: null,
    note: '',
    occurrenceId: null,
    scheduledFor: null,
    status: 'done',
    userId: 'user-1',
    ...overrides,
  }
}

function createListResponse(
  overrides: Partial<SelfCareListResponse> = {},
): SelfCareListResponse {
  return {
    alternatives: [],
    appointmentDetails: [],
    courseDetails: [],
    items: [],
    medicalDetails: [],
    measurementDetails: [],
    procedureDetails: [],
    scheduleRules: [],
    steps: [],
    ...overrides,
  }
}

function createTemplate(
  overrides: Partial<SelfCareTemplate> = {},
): SelfCareTemplate {
  return {
    category: 'health',
    color: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    defaultSchedule: null,
    defaultSteps: [],
    description: '',
    icon: null,
    id: 'template-1',
    importance: 'recommended',
    isSystem: true,
    title: 'Шаблон',
    type: 'habit',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function createDashboardResponse(
  overrides: Partial<SelfCareDashboardResponse> = {},
): SelfCareDashboardResponse {
  return {
    dailyState: null,
    date: '2026-06-22',
    flexibleGoals: [],
    gentleMode: false,
    minimumItems: [],
    overdueItems: [],
    planningHints: [],
    settings: createSettings(),
    todayItems: [],
    upcomingImportant: [],
    ...overrides,
  }
}

function createSettingsResponse(
  overrides: Partial<SelfCareSettingsResponse> = {},
): SelfCareSettingsResponse {
  return {
    minimumItems: [],
    settings: createSettings(),
    ...overrides,
  }
}

function createSettings(): SelfCareSettingsResponse['settings'] {
  return {
    createdAt: '2026-06-01T00:00:00.000Z',
    currency: 'RUB',
    defaultReminderTone: 'soft',
    gentleModeDate: null,
    gentleModeEnabledToday: false,
    id: 'settings-1',
    quietHoursEnd: null,
    quietHoursStart: null,
    showAppointmentsInCalendar: true,
    showSelfCareInMainTasks: true,
    updatedAt: '2026-06-01T00:00:00.000Z',
    userId: 'user-1',
  }
}

function createRitualStepDraftResponse() {
  return {
    date: '2026-06-22',
    drafts: [
      {
        date: '2026-06-22',
        itemId: 'ritual-1',
        occurrenceId: null,
        stepIds: ['step-1'],
      },
    ],
  }
}
