import {
  type SelfCareAnalyticsResponse,
  selfCareAnalyticsResponseSchema,
  type SelfCareCompletion,
  type SelfCareCompletionInput,
  selfCareCompletionInputSchema,
  selfCareCompletionSchema,
  type SelfCareDailyState,
  type SelfCareDailyStateInput,
  selfCareDailyStateInputSchema,
  selfCareDailyStateSchema,
  type SelfCareDashboardResponse,
  selfCareDashboardResponseSchema,
  type SelfCareHistoryResponse,
  selfCareHistoryResponseSchema,
  type SelfCareItem,
  type SelfCareItemInput,
  selfCareItemInputSchema,
  type SelfCareItemScheduleInput,
  selfCareItemScheduleInputSchema,
  selfCareItemSchema,
  type SelfCareItemUpdateInput,
  selfCareItemUpdateInputSchema,
  type SelfCareListResponse,
  selfCareListResponseSchema,
  type SelfCareMinimumItemsUpdateInput,
  selfCareMinimumItemsUpdateInputSchema,
  type SelfCareOccurrence,
  type SelfCareOccurrenceMoveInput,
  selfCareOccurrenceMoveInputSchema,
  selfCareOccurrenceSchema,
  type SelfCareOccurrenceSkipInput,
  selfCareOccurrenceSkipInputSchema,
  type SelfCarePlanResponse,
  selfCarePlanResponseSchema,
  type SelfCareRitualCompletionInput,
  selfCareRitualCompletionInputSchema,
  type SelfCareRitualStepDraftInput,
  selfCareRitualStepDraftInputSchema,
  type SelfCareRitualStepDraftListResponse,
  selfCareRitualStepDraftListResponseSchema,
  type SelfCareRitualStepInput,
  selfCareRitualStepInputSchema,
  type SelfCareSettingsResponse,
  selfCareSettingsResponseSchema,
  type SelfCareSettingsUpdateInput,
  selfCareSettingsUpdateInputSchema,
  type SelfCareTemplate,
  type SelfCareTemplateCreateInput,
  selfCareTemplateCreateInputSchema,
  selfCareTemplateSchema,
} from '@planner/contracts'
import { z } from 'zod'

import {
  type ApiClientFetch,
  type ApiRequestSignal,
  createApiRequester,
} from '@/shared/lib/api-client'

type RequestSignal = ApiRequestSignal

type SelfCareListFilters = {
  category?: string | undefined
  includeArchived?: boolean | undefined
  type?: string | undefined
}

export class SelfCareApiError extends Error {
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
    this.name = 'SelfCareApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export interface SelfCareApiClientConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  clientTimeZone?: string | undefined
  workspaceId: string
}

export interface SelfCareApiClient {
  archiveItem: (itemId: string) => Promise<SelfCareItem>
  cancelOccurrence: (occurrenceId: string) => Promise<SelfCareOccurrence>
  completeFlexibleGoal: (
    itemId: string,
    input?: SelfCareCompletionInput,
  ) => Promise<SelfCareCompletion>
  completeCourseSession: (
    itemId: string,
    input?: SelfCareCompletionInput,
  ) => Promise<SelfCareCompletion>
  completeItemNow: (
    itemId: string,
    input?: SelfCareRitualCompletionInput,
  ) => Promise<SelfCareCompletion>
  completeOccurrence: (
    occurrenceId: string,
    input?: SelfCareRitualCompletionInput,
  ) => Promise<SelfCareCompletion>
  createItem: (input: SelfCareItemInput) => Promise<SelfCareItem>
  createItemFromTemplate: (
    templateId: string,
    input?: SelfCareTemplateCreateInput,
  ) => Promise<SelfCareItem>
  deleteItem: (itemId: string) => Promise<void>
  deleteRitualStepDraft: (input: {
    date: string
    itemId: string
    occurrenceId: string | null
  }) => Promise<SelfCareRitualStepDraftListResponse>
  disableGentleMode: (date: string) => Promise<SelfCareSettingsResponse>
  enableGentleMode: (date: string) => Promise<SelfCareSettingsResponse>
  generateOccurrences: (
    from: string,
    to: string,
  ) => Promise<SelfCareOccurrence[]>
  getAnalytics: (
    from: string,
    to: string,
    signal?: RequestSignal,
  ) => Promise<SelfCareAnalyticsResponse>
  getDailyState: (
    date: string,
    signal?: RequestSignal,
  ) => Promise<SelfCareDailyState | null>
  getDashboard: (
    date: string,
    signal?: RequestSignal,
  ) => Promise<SelfCareDashboardResponse>
  getHistory: (
    from: string,
    to: string,
    signal?: RequestSignal,
  ) => Promise<SelfCareHistoryResponse>
  getOccurrences: (
    from: string,
    to: string,
    signal?: RequestSignal,
  ) => Promise<SelfCareOccurrence[]>
  getPlan: (
    from: string,
    to: string,
    signal?: RequestSignal,
  ) => Promise<SelfCarePlanResponse>
  getRitualStepDrafts: (
    date: string,
    signal?: RequestSignal,
  ) => Promise<SelfCareRitualStepDraftListResponse>
  getSettings: (signal?: RequestSignal) => Promise<SelfCareSettingsResponse>
  listItems: (
    filters?: SelfCareListFilters,
    signal?: RequestSignal,
  ) => Promise<SelfCareListResponse>
  listTemplates: (signal?: RequestSignal) => Promise<SelfCareTemplate[]>
  moveOccurrence: (
    occurrenceId: string,
    input: SelfCareOccurrenceMoveInput,
  ) => Promise<SelfCareOccurrence>
  restoreItem: (itemId: string) => Promise<SelfCareItem>
  scheduleItem: (
    itemId: string,
    input: SelfCareItemScheduleInput,
  ) => Promise<SelfCareOccurrence>
  skipOccurrence: (
    occurrenceId: string,
    input?: SelfCareOccurrenceSkipInput,
  ) => Promise<SelfCareOccurrence>
  updateItem: (
    itemId: string,
    input: SelfCareItemUpdateInput,
  ) => Promise<SelfCareItem>
  updateMinimumItems: (
    input: SelfCareMinimumItemsUpdateInput,
  ) => Promise<SelfCareSettingsResponse>
  updateSettings: (
    input: SelfCareSettingsUpdateInput,
  ) => Promise<SelfCareSettingsResponse>
  updateRitualSteps: (
    itemId: string,
    steps: SelfCareRitualStepInput[],
  ) => Promise<SelfCareListResponse>
  upsertDailyState: (
    date: string,
    input: SelfCareDailyStateInput,
  ) => Promise<SelfCareDailyState>
  upsertRitualStepDraft: (
    input: SelfCareRitualStepDraftInput,
  ) => Promise<SelfCareRitualStepDraftListResponse>
}

const selfCareOccurrenceListSchema = z.array(selfCareOccurrenceSchema)
const selfCareDailyStateNullableSchema = selfCareDailyStateSchema.nullable()
const selfCareTemplateListSchema = z.array(selfCareTemplateSchema)
const selfCareRitualStepsUpdateInputSchema = z.object({
  steps: z.array(selfCareRitualStepInputSchema),
})

export function createSelfCareApiClient(
  config: SelfCareApiClientConfig,
  fetchFn: ApiClientFetch = fetch,
): SelfCareApiClient {
  const { request } = createApiRequester(
    config,
    (message, options) => new SelfCareApiError(message, options),
    fetchFn,
    {
      fallbackErrorCode: 'self_care_request_failed',
      fallbackErrorMessage: 'Self-care request failed.',
    },
  )

  return {
    archiveItem(itemId) {
      return request({
        method: 'POST',
        path: `/api/v1/self-care/${encodeURIComponent(itemId)}/archive`,
        responseSchema: selfCareItemSchema,
        writeAccess: true,
      })
    },
    cancelOccurrence(occurrenceId) {
      return request({
        method: 'POST',
        path: `/api/v1/self-care/occurrences/${encodeURIComponent(occurrenceId)}/cancel`,
        responseSchema: selfCareOccurrenceSchema,
        writeAccess: true,
      })
    },
    completeCourseSession(itemId, input) {
      return request({
        body: selfCareCompletionInputSchema.parse(input ?? {}),
        method: 'POST',
        path: `/api/v1/self-care/items/${encodeURIComponent(itemId)}/complete-course-session`,
        responseSchema: selfCareCompletionSchema,
        writeAccess: true,
      })
    },
    completeFlexibleGoal(itemId, input) {
      return request({
        body: selfCareCompletionInputSchema.parse(input ?? {}),
        method: 'POST',
        path: `/api/v1/self-care/items/${encodeURIComponent(itemId)}/complete-flexible-goal`,
        responseSchema: selfCareCompletionSchema,
        writeAccess: true,
      })
    },
    completeItemNow(itemId, input) {
      return request({
        body: selfCareRitualCompletionInputSchema.parse(input ?? {}),
        method: 'POST',
        path: `/api/v1/self-care/items/${encodeURIComponent(itemId)}/complete-now`,
        responseSchema: selfCareCompletionSchema,
        writeAccess: true,
      })
    },
    completeOccurrence(occurrenceId, input) {
      return request({
        body: selfCareRitualCompletionInputSchema.parse(input ?? {}),
        method: 'POST',
        path: `/api/v1/self-care/occurrences/${encodeURIComponent(occurrenceId)}/complete`,
        responseSchema: selfCareCompletionSchema,
        writeAccess: true,
      })
    },
    createItem(input) {
      return request({
        body: selfCareItemInputSchema.parse(input),
        method: 'POST',
        path: '/api/v1/self-care',
        responseSchema: selfCareItemSchema,
        writeAccess: true,
      })
    },
    createItemFromTemplate(templateId, input) {
      return request({
        body: selfCareTemplateCreateInputSchema.parse(input ?? {}),
        method: 'POST',
        path: `/api/v1/self-care/templates/${encodeURIComponent(templateId)}/create`,
        responseSchema: selfCareItemSchema,
        writeAccess: true,
      })
    },
    deleteItem(itemId) {
      return request<void>({
        method: 'DELETE',
        path: `/api/v1/self-care/${encodeURIComponent(itemId)}`,
        writeAccess: true,
      })
    },
    deleteRitualStepDraft(input) {
      return request({
        method: 'DELETE',
        path: '/api/v1/self-care/ritual-step-drafts',
        query: {
          date: input.date,
          itemId: input.itemId,
          occurrenceId: input.occurrenceId ?? undefined,
        },
        responseSchema: selfCareRitualStepDraftListResponseSchema,
        writeAccess: true,
      })
    },
    disableGentleMode(date) {
      return request({
        method: 'POST',
        path: '/api/v1/self-care/settings/gentle-mode/disable',
        query: { date },
        responseSchema: selfCareSettingsResponseSchema,
        writeAccess: true,
      })
    },
    enableGentleMode(date) {
      return request({
        method: 'POST',
        path: '/api/v1/self-care/settings/gentle-mode/enable',
        query: { date },
        responseSchema: selfCareSettingsResponseSchema,
        writeAccess: true,
      })
    },
    generateOccurrences(from, to) {
      return request({
        body: { from, to },
        method: 'POST',
        path: '/api/v1/self-care/generate-occurrences',
        responseSchema: selfCareOccurrenceListSchema,
        writeAccess: true,
      })
    },
    getAnalytics(from, to, signal) {
      return request({
        path: '/api/v1/self-care/analytics',
        query: { from, to },
        responseSchema: selfCareAnalyticsResponseSchema,
        signal,
      })
    },
    getDailyState(date, signal) {
      return request({
        path: '/api/v1/self-care/daily-state',
        query: { date },
        responseSchema: selfCareDailyStateNullableSchema,
        signal,
      })
    },
    getDashboard(date, signal) {
      return request({
        path: '/api/v1/self-care/dashboard',
        query: { date },
        responseSchema: selfCareDashboardResponseSchema,
        signal,
      })
    },
    getHistory(from, to, signal) {
      return request({
        path: '/api/v1/self-care/history',
        query: { from, to },
        responseSchema: selfCareHistoryResponseSchema,
        signal,
      })
    },
    getOccurrences(from, to, signal) {
      return request({
        path: '/api/v1/self-care/occurrences',
        query: { from, to },
        responseSchema: selfCareOccurrenceListSchema,
        signal,
      })
    },
    getPlan(from, to, signal) {
      return request({
        path: '/api/v1/self-care/plan',
        query: { from, to },
        responseSchema: selfCarePlanResponseSchema,
        signal,
      })
    },
    getRitualStepDrafts(date, signal) {
      return request({
        path: '/api/v1/self-care/ritual-step-drafts',
        query: { date },
        responseSchema: selfCareRitualStepDraftListResponseSchema,
        signal,
      })
    },
    getSettings(signal) {
      return request({
        path: '/api/v1/self-care/settings',
        responseSchema: selfCareSettingsResponseSchema,
        signal,
      })
    },
    listItems(filters = {}, signal) {
      return request({
        path: '/api/v1/self-care',
        query: {
          category: filters.category,
          includeArchived: filters.includeArchived ? 'true' : undefined,
          type: filters.type,
        },
        responseSchema: selfCareListResponseSchema,
        signal,
      })
    },
    listTemplates(signal) {
      return request({
        path: '/api/v1/self-care/templates',
        responseSchema: selfCareTemplateListSchema,
        signal,
      })
    },
    moveOccurrence(occurrenceId, input) {
      return request({
        body: selfCareOccurrenceMoveInputSchema.parse(input),
        method: 'POST',
        path: `/api/v1/self-care/occurrences/${encodeURIComponent(occurrenceId)}/move`,
        responseSchema: selfCareOccurrenceSchema,
        writeAccess: true,
      })
    },
    restoreItem(itemId) {
      return request({
        method: 'POST',
        path: `/api/v1/self-care/${encodeURIComponent(itemId)}/restore`,
        responseSchema: selfCareItemSchema,
        writeAccess: true,
      })
    },
    scheduleItem(itemId, input) {
      return request({
        body: selfCareItemScheduleInputSchema.parse(input),
        method: 'POST',
        path: `/api/v1/self-care/items/${encodeURIComponent(itemId)}/schedule`,
        responseSchema: selfCareOccurrenceSchema,
        writeAccess: true,
      })
    },
    skipOccurrence(occurrenceId, input) {
      return request({
        body: selfCareOccurrenceSkipInputSchema.parse(input ?? {}),
        method: 'POST',
        path: `/api/v1/self-care/occurrences/${encodeURIComponent(occurrenceId)}/skip`,
        responseSchema: selfCareOccurrenceSchema,
        writeAccess: true,
      })
    },
    updateItem(itemId, input) {
      return request({
        body: selfCareItemUpdateInputSchema.parse(input),
        method: 'PATCH',
        path: `/api/v1/self-care/${encodeURIComponent(itemId)}`,
        responseSchema: selfCareItemSchema,
        writeAccess: true,
      })
    },
    updateMinimumItems(input) {
      return request({
        body: selfCareMinimumItemsUpdateInputSchema.parse(input),
        method: 'PUT',
        path: '/api/v1/self-care/settings/minimum-items',
        responseSchema: selfCareSettingsResponseSchema,
        writeAccess: true,
      })
    },
    updateRitualSteps(itemId, steps) {
      return request({
        body: selfCareRitualStepsUpdateInputSchema.parse({ steps }),
        method: 'PUT',
        path: `/api/v1/self-care/items/${encodeURIComponent(itemId)}/steps`,
        responseSchema: selfCareListResponseSchema,
        writeAccess: true,
      })
    },
    updateSettings(input) {
      return request({
        body: selfCareSettingsUpdateInputSchema.parse(input),
        method: 'PATCH',
        path: '/api/v1/self-care/settings',
        responseSchema: selfCareSettingsResponseSchema,
        writeAccess: true,
      })
    },
    upsertDailyState(date, input) {
      return request({
        body: selfCareDailyStateInputSchema.parse(input),
        method: 'PUT',
        path: '/api/v1/self-care/daily-state',
        query: { date },
        responseSchema: selfCareDailyStateSchema,
        writeAccess: true,
      })
    },
    upsertRitualStepDraft(input) {
      return request({
        body: selfCareRitualStepDraftInputSchema.parse(input),
        method: 'PUT',
        path: '/api/v1/self-care/ritual-step-drafts',
        responseSchema: selfCareRitualStepDraftListResponseSchema,
        writeAccess: true,
      })
    },
  }
}
