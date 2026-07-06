import {
  type HabitTodayResponse,
  type SelfCareCompletion,
  type SelfCareCompletionInput,
  type SelfCareCompletionUpdateInput,
  type SelfCareDailyStateInput,
  type SelfCareDashboardResponse,
  type SelfCareHistoryResponse,
  type SelfCareItemInput,
  type SelfCareItemScheduleInput,
  type SelfCareItemUpdateInput,
  type SelfCareMinimumItemsUpdateInput,
  type SelfCareOccurrence,
  type SelfCareOccurrenceMoveInput,
  type SelfCareOccurrenceSkipInput,
  type SelfCareOccurrenceStatus,
  type SelfCarePlanResponse,
  type SelfCareRitualCompletionInput,
  type SelfCareRitualStepDraftInput,
  type SelfCareRitualStepDraftListResponse,
  type SelfCareSettingsUpdateInput,
  type SelfCareTemplateCreateInput,
  type SelfCareTodayItem,
} from '@planner/contracts'
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  usePlannerTimeZone,
  useSessionFeatureReadiness,
} from '@/features/session'
import { addDateDays, getTodayDate } from '@/shared/time/time.service'

import {
  createSelfCareApiClient,
  type SelfCareApiClient,
  SelfCareApiError,
} from './self-care-api'

interface OccurrenceMutationVariables<TInput> {
  input?: TInput | undefined
  occurrenceId: string
  skipInvalidation?: boolean | undefined
}

interface RequiredOccurrenceMutationVariables<TInput> {
  input: TInput
  invalidationScopes?: readonly SelfCareQueryScope[] | undefined
  occurrenceId: string
  skipInvalidation?: boolean | undefined
}

interface ItemCompletionVariables<TInput> {
  input?: TInput | undefined
  itemId: string
}

interface CompletionUpdateVariables {
  completionId: string
  input: SelfCareCompletionUpdateInput
}

interface ItemScheduleVariables {
  input: SelfCareItemScheduleInput
  invalidationScopes?: readonly SelfCareQueryScope[] | undefined
  itemId: string
  skipInvalidation?: boolean | undefined
}

interface ItemUpdateVariables {
  input: SelfCareItemUpdateInput
  itemId: string
  skipInvalidation?: boolean | undefined
}

interface CreateItemVariables {
  input: SelfCareItemInput
  skipInvalidation?: boolean | undefined
}

interface CreateFromTemplateVariables {
  input?: SelfCareTemplateCreateInput | undefined
  templateId: string
}

interface RitualStepDraftDeleteVariables {
  date: string
  itemId: string
  occurrenceId: string | null
}

type SelfCareQueryScope =
  | 'analytics'
  | 'dashboard'
  | 'history'
  | 'items'
  | 'plan'
  | 'ritual-step-drafts'
  | 'settings'
  | 'templates'

type SelfCareRefetchType = 'active' | 'all' | 'inactive' | 'none'

interface SelfCareInvalidationOptions {
  refetchType?: SelfCareRefetchType | undefined
  skipInvalidation?: boolean | undefined
}

const SELF_CARE_ITEM_CHANGE_SCOPES: readonly SelfCareQueryScope[] = [
  'dashboard',
  'items',
  'plan',
  'history',
  'analytics',
]
const SELF_CARE_OCCURRENCE_CHANGE_SCOPES: readonly SelfCareQueryScope[] = [
  'dashboard',
  'plan',
  'history',
  'analytics',
]
const SELF_CARE_COMPLETION_CHANGE_SCOPES: readonly SelfCareQueryScope[] = [
  'dashboard',
  'items',
  'plan',
  'history',
  'analytics',
  'ritual-step-drafts',
]
const SELF_CARE_SETTINGS_CHANGE_SCOPES: readonly SelfCareQueryScope[] = [
  'dashboard',
  'settings',
]
const SELF_CARE_STALE_ONLY_INVALIDATION = {
  refetchType: 'none',
} satisfies SelfCareInvalidationOptions

export const SELF_CARE_API_UNAVAILABLE_MESSAGE =
  'Сессия еще не готова. Подожди пару секунд и попробуй снова.'

export class SelfCareApiUnavailableError extends Error {
  constructor() {
    super(SELF_CARE_API_UNAVAILABLE_MESSAGE)
    this.name = 'SelfCareApiUnavailableError'
  }
}

export function isSelfCareApiUnavailableError(
  error: unknown,
): error is SelfCareApiUnavailableError {
  return (
    error instanceof SelfCareApiUnavailableError ||
    (error instanceof Error &&
      error.message === SELF_CARE_API_UNAVAILABLE_MESSAGE)
  )
}

export function selfCareDashboardQueryKey(workspaceId: string, date: string) {
  return ['self-care', workspaceId, 'dashboard', date] as const
}

export function selfCareItemsQueryKey(workspaceId: string) {
  return ['self-care', workspaceId, 'items'] as const
}

export function selfCarePlanQueryKey(
  workspaceId: string,
  from: string,
  to: string,
) {
  return ['self-care', workspaceId, 'plan', from, to] as const
}

export function selfCareRitualStepDraftsQueryKey(
  workspaceId: string,
  date: string,
) {
  return ['self-care', workspaceId, 'ritual-step-drafts', date] as const
}

export function selfCareHistoryQueryKey(
  workspaceId: string,
  from: string,
  to: string,
) {
  return ['self-care', workspaceId, 'history', from, to] as const
}

export function selfCareAnalyticsQueryKey(
  workspaceId: string,
  from: string,
  to: string,
) {
  return ['self-care', workspaceId, 'analytics', from, to] as const
}

export function selfCareSettingsQueryKey(workspaceId: string) {
  return ['self-care', workspaceId, 'settings'] as const
}

export function selfCareTemplatesQueryKey(workspaceId: string) {
  return ['self-care', workspaceId, 'templates'] as const
}

export function useSelfCareDashboard(
  date?: string,
  options: { enabled?: boolean } = {},
) {
  const { api, isEnabled, workspaceId } = useSelfCareApi(options)
  const plannerTimeZone = usePlannerTimeZone()
  const resolvedDate = date ?? getTodayDate(plannerTimeZone)
  const queryKey = useMemo(
    () => selfCareDashboardQueryKey(workspaceId, resolvedDate),
    [resolvedDate, workspaceId],
  )

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) =>
      requireSelfCareApi(api).getDashboard(resolvedDate, signal),
    queryKey,
    staleTime: 20_000,
  })
}

export function useSelfCareItems(options: { enabled?: boolean } = {}) {
  const { api, isEnabled, workspaceId } = useSelfCareApi(options)
  const queryKey = useMemo(
    () => selfCareItemsQueryKey(workspaceId),
    [workspaceId],
  )

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) => requireSelfCareApi(api).listItems({}, signal),
    queryKey,
    staleTime: 30_000,
  })
}

export function useSelfCarePlan(
  from?: string,
  to?: string,
  options: { enabled?: boolean } = {},
) {
  const { api, isEnabled, workspaceId } = useSelfCareApi(options)
  const plannerTimeZone = usePlannerTimeZone()
  const resolvedFrom = from ?? getTodayDate(plannerTimeZone)
  const resolvedTo = to ?? addDateDays(resolvedFrom, 45)
  const queryKey = useMemo(
    () => selfCarePlanQueryKey(workspaceId, resolvedFrom, resolvedTo),
    [resolvedFrom, resolvedTo, workspaceId],
  )

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) =>
      requireSelfCareApi(api).getPlan(resolvedFrom, resolvedTo, signal),
    queryKey,
    staleTime: 30_000,
  })
}

export function useSelfCareRitualStepDrafts(
  date?: string,
  options: { enabled?: boolean } = {},
) {
  const { api, isEnabled, workspaceId } = useSelfCareApi(options)
  const plannerTimeZone = usePlannerTimeZone()
  const resolvedDate = date ?? getTodayDate(plannerTimeZone)
  const queryKey = useMemo(
    () => selfCareRitualStepDraftsQueryKey(workspaceId, resolvedDate),
    [resolvedDate, workspaceId],
  )

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) =>
      requireSelfCareApi(api).getRitualStepDrafts(resolvedDate, signal),
    queryKey,
    staleTime: 20_000,
  })
}

export function useSelfCareHistory(
  from?: string,
  to?: string,
  options: { enabled?: boolean } = {},
) {
  const { api, isEnabled, workspaceId } = useSelfCareApi(options)
  const plannerTimeZone = usePlannerTimeZone()
  const resolvedTo = to ?? getTodayDate(plannerTimeZone)
  const resolvedFrom = from ?? addDateDays(resolvedTo, -30)
  const queryKey = useMemo(
    () => selfCareHistoryQueryKey(workspaceId, resolvedFrom, resolvedTo),
    [resolvedFrom, resolvedTo, workspaceId],
  )

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) =>
      requireSelfCareApi(api).getHistory(resolvedFrom, resolvedTo, signal),
    queryKey,
    staleTime: 30_000,
  })
}

export function useSelfCareAnalytics(
  from?: string,
  to?: string,
  options: { enabled?: boolean } = {},
) {
  const { api, isEnabled, workspaceId } = useSelfCareApi(options)
  const plannerTimeZone = usePlannerTimeZone()
  const resolvedTo = to ?? getTodayDate(plannerTimeZone)
  const resolvedFrom = from ?? addDateDays(resolvedTo, -30)
  const queryKey = useMemo(
    () => selfCareAnalyticsQueryKey(workspaceId, resolvedFrom, resolvedTo),
    [resolvedFrom, resolvedTo, workspaceId],
  )

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) =>
      requireSelfCareApi(api).getAnalytics(resolvedFrom, resolvedTo, signal),
    queryKey,
    staleTime: 30_000,
  })
}

export function useSelfCareSettings(options: { enabled?: boolean } = {}) {
  const { api, isEnabled, workspaceId } = useSelfCareApi(options)
  const queryKey = useMemo(
    () => selfCareSettingsQueryKey(workspaceId),
    [workspaceId],
  )

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) => requireSelfCareApi(api).getSettings(signal),
    queryKey,
    staleTime: 30_000,
  })
}

export function useSelfCareTemplates(options: { enabled?: boolean } = {}) {
  const { api, isEnabled, workspaceId } = useSelfCareApi(options)
  const queryKey = useMemo(
    () => selfCareTemplatesQueryKey(workspaceId),
    [workspaceId],
  )

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) => requireSelfCareApi(api).listTemplates(signal),
    queryKey,
    staleTime: 300_000,
  })
}

export function useCreateSelfCareItem() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async (variables: SelfCareItemInput | CreateItemVariables) => {
      const { input, skipInvalidation } =
        normalizeCreateItemVariables(variables)
      assertSession(session, 'создать заботу')
      const item = await requireSelfCareApi(api).createItem(input)
      queueSelfCareInvalidationUnlessSkipped(
        queryClient,
        workspaceId,
        SELF_CARE_ITEM_CHANGE_SCOPES,
        { skipInvalidation },
      )
      return item
    },
  })
}

export function useCreateSelfCareItemFromTemplate() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async ({ input, templateId }: CreateFromTemplateVariables) => {
      assertSession(session, 'создать заботу из шаблона')
      const item = await requireSelfCareApi(api).createItemFromTemplate(
        templateId,
        input,
      )
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_ITEM_CHANGE_SCOPES,
      )
      return item
    },
  })
}

export function useUpdateSelfCareItem() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async ({
      input,
      itemId,
      skipInvalidation,
    }: ItemUpdateVariables) => {
      assertSession(session, 'обновить заботу')
      const item = await requireSelfCareApi(api).updateItem(itemId, input)
      queueSelfCareInvalidationUnlessSkipped(
        queryClient,
        workspaceId,
        SELF_CARE_ITEM_CHANGE_SCOPES,
        { skipInvalidation },
      )
      return item
    },
  })
}

export function useArchiveSelfCareItem() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async (itemId: string) => {
      assertSession(session, 'архивировать заботу')
      const item = await requireSelfCareApi(api).archiveItem(itemId)
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_ITEM_CHANGE_SCOPES,
      )
      void invalidateMigratedHabitRoutine(
        queryClient,
        workspaceId,
        item.migratedFromHabitId,
      )
      return item
    },
  })
}

export function useCancelSelfCareOccurrence() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async (occurrenceId: string) => {
      assertSession(session, 'убрать заботу из плана')
      const occurrence =
        await requireSelfCareApi(api).cancelOccurrence(occurrenceId)
      applySelfCareOccurrenceToCache(queryClient, workspaceId, occurrence)
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_OCCURRENCE_CHANGE_SCOPES,
        SELF_CARE_STALE_ONLY_INVALIDATION,
      )
      return occurrence
    },
  })
}

export function useCompleteSelfCareOccurrence() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async ({
      input,
      occurrenceId,
    }: OccurrenceMutationVariables<SelfCareRitualCompletionInput>) => {
      assertSession(session, 'отметить заботу')
      const completion = await requireSelfCareApi(api).completeOccurrence(
        occurrenceId,
        input,
      )
      applySelfCareCompletionToCache(queryClient, workspaceId, completion)
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_COMPLETION_CHANGE_SCOPES,
        SELF_CARE_STALE_ONLY_INVALIDATION,
      )
      return completion
    },
  })
}

export function useUpsertSelfCareRitualStepDraft() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async (input: SelfCareRitualStepDraftInput) => {
      assertSession(session, 'сохранить этапы заботы')
      const result = await requireSelfCareApi(api).upsertRitualStepDraft(input)
      setRitualStepDraftQueryData(queryClient, workspaceId, result)
      return result
    },
  })
}

export function useDeleteSelfCareRitualStepDraft() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async (input: RitualStepDraftDeleteVariables) => {
      assertSession(session, 'очистить этапы заботы')
      const result = await requireSelfCareApi(api).deleteRitualStepDraft(input)
      setRitualStepDraftQueryData(queryClient, workspaceId, result)
      return result
    },
  })
}

export function useCompleteSelfCareItemNow() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async ({
      input,
      itemId,
    }: ItemCompletionVariables<SelfCareRitualCompletionInput>) => {
      assertSession(session, 'отметить заботу')
      const completion = await requireSelfCareApi(api).completeItemNow(
        itemId,
        input,
      )
      applySelfCareCompletionToCache(queryClient, workspaceId, completion)
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_COMPLETION_CHANGE_SCOPES,
        SELF_CARE_STALE_ONLY_INVALIDATION,
      )
      return completion
    },
  })
}

export function useUpdateSelfCareCompletion() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async ({ completionId, input }: CompletionUpdateVariables) => {
      assertSession(session, 'обновить запись заботы')
      const completion = await requireSelfCareApi(api).updateCompletion(
        completionId,
        input,
      )
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_COMPLETION_CHANGE_SCOPES,
      )
      return completion
    },
  })
}

export function useCompleteSelfCareFlexibleGoal() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async ({
      input,
      itemId,
    }: ItemCompletionVariables<SelfCareCompletionInput>) => {
      assertSession(session, 'засчитать гибкую цель')
      const completion = await requireSelfCareApi(api).completeFlexibleGoal(
        itemId,
        input,
      )
      applySelfCareCompletionToCache(queryClient, workspaceId, completion)
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_OCCURRENCE_CHANGE_SCOPES,
        SELF_CARE_STALE_ONLY_INVALIDATION,
      )
      return completion
    },
  })
}

export function useCompleteSelfCareCourseSession() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async ({
      input,
      itemId,
    }: ItemCompletionVariables<SelfCareCompletionInput>) => {
      assertSession(session, 'засчитать курс')
      const completion = await requireSelfCareApi(api).completeCourseSession(
        itemId,
        input,
      )
      applySelfCareCompletionToCache(queryClient, workspaceId, completion)
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_COMPLETION_CHANGE_SCOPES,
        SELF_CARE_STALE_ONLY_INVALIDATION,
      )
      return completion
    },
  })
}

export function useSkipSelfCareOccurrence() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async ({
      input,
      occurrenceId,
    }: OccurrenceMutationVariables<SelfCareOccurrenceSkipInput>) => {
      assertSession(session, 'мягко пропустить заботу')
      const occurrence = await requireSelfCareApi(api).skipOccurrence(
        occurrenceId,
        input,
      )
      applySelfCareOccurrenceToCache(queryClient, workspaceId, occurrence)
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_OCCURRENCE_CHANGE_SCOPES,
        SELF_CARE_STALE_ONLY_INVALIDATION,
      )
      return occurrence
    },
  })
}

export function useMoveSelfCareOccurrence() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async ({
      input,
      invalidationScopes,
      occurrenceId,
      skipInvalidation,
    }: RequiredOccurrenceMutationVariables<SelfCareOccurrenceMoveInput>) => {
      assertSession(session, 'перенести заботу')
      const occurrence = await requireSelfCareApi(api).moveOccurrence(
        occurrenceId,
        input,
      )
      queueSelfCareInvalidationUnlessSkipped(
        queryClient,
        workspaceId,
        invalidationScopes ?? SELF_CARE_OCCURRENCE_CHANGE_SCOPES,
        { skipInvalidation },
      )
      return occurrence
    },
  })
}

export function useScheduleSelfCareItem() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async ({
      input,
      invalidationScopes,
      itemId,
      skipInvalidation,
    }: ItemScheduleVariables) => {
      assertSession(session, 'запланировать заботу')
      const occurrence = await requireSelfCareApi(api).scheduleItem(
        itemId,
        input,
      )
      queueSelfCareInvalidationUnlessSkipped(
        queryClient,
        workspaceId,
        invalidationScopes ?? SELF_CARE_ITEM_CHANGE_SCOPES,
        { skipInvalidation },
      )
      return occurrence
    },
  })
}

export function useEnableSelfCareGentleMode() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async (date: string) => {
      assertSession(session, 'включить бережный режим')
      const settings = await requireSelfCareApi(api).enableGentleMode(date)
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_SETTINGS_CHANGE_SCOPES,
      )
      return settings
    },
  })
}

export function useDisableSelfCareGentleMode() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async (date: string) => {
      assertSession(session, 'выключить бережный режим')
      const settings = await requireSelfCareApi(api).disableGentleMode(date)
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_SETTINGS_CHANGE_SCOPES,
      )
      return settings
    },
  })
}

export function useUpdateSelfCareMinimumItems() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async (input: SelfCareMinimumItemsUpdateInput) => {
      assertSession(session, 'обновить минимум заботы')
      const settings = await requireSelfCareApi(api).updateMinimumItems(input)
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_SETTINGS_CHANGE_SCOPES,
      )
      return settings
    },
  })
}

export function useUpdateSelfCareSettings() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async (input: SelfCareSettingsUpdateInput) => {
      assertSession(session, 'обновить настройки заботы')
      const settings = await requireSelfCareApi(api).updateSettings(input)
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_SETTINGS_CHANGE_SCOPES,
      )
      return settings
    },
  })
}

export function useUpsertSelfCareDailyState() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async ({
      date,
      input,
    }: {
      date: string
      input: SelfCareDailyStateInput
    }) => {
      assertSession(session, 'сохранить состояние')
      const state = await requireSelfCareApi(api).upsertDailyState(date, input)
      queueSelfCareInvalidation(queryClient, workspaceId, [
        'dashboard',
        'analytics',
      ])
      return state
    },
  })
}

export function getSelfCareErrorMessage(error: unknown): string {
  if (error instanceof SelfCareApiError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Не получилось сохранить. Попробуй еще раз.'
}

function useSelfCareApi(options: { enabled?: boolean } = {}) {
  const { apiConfig, isApiEnabled, session, workspaceId } =
    useSessionFeatureReadiness({ enabled: options.enabled })
  const api = useMemo(
    () => (apiConfig ? createSelfCareApiClient(apiConfig) : null),
    [apiConfig],
  )

  return {
    api,
    isEnabled: isApiEnabled && api !== null,
    session,
    workspaceId,
  }
}

function requireSelfCareApi(api: SelfCareApiClient | null): SelfCareApiClient {
  if (!api) {
    throw new SelfCareApiUnavailableError()
  }

  return api
}

function assertSession(session: unknown, _action: string): void {
  if (!session) {
    throw new SelfCareApiUnavailableError()
  }
}

function normalizeCreateItemVariables(
  variables: SelfCareItemInput | CreateItemVariables,
): CreateItemVariables {
  if (
    typeof variables === 'object' &&
    variables !== null &&
    'input' in variables
  ) {
    return variables
  }

  return { input: variables }
}

function queueSelfCareInvalidationUnlessSkipped(
  queryClient: QueryClient,
  workspaceId: string,
  scopes: readonly SelfCareQueryScope[],
  options: SelfCareInvalidationOptions = {},
): void {
  if (options.skipInvalidation) {
    return
  }

  queueSelfCareInvalidation(queryClient, workspaceId, scopes, options)
}

function queueSelfCareInvalidation(
  queryClient: QueryClient,
  workspaceId: string,
  scopes: readonly SelfCareQueryScope[],
  options: SelfCareInvalidationOptions = {},
): void {
  const scopeSet = new Set<SelfCareQueryScope>(scopes)
  const predicate = (query: { queryKey: readonly unknown[] }) =>
    Array.isArray(query.queryKey) &&
    query.queryKey[0] === 'self-care' &&
    query.queryKey[1] === workspaceId &&
    typeof query.queryKey[2] === 'string' &&
    scopeSet.has(query.queryKey[2] as SelfCareQueryScope)

  void queryClient.invalidateQueries(
    options.refetchType
      ? { predicate, refetchType: options.refetchType }
      : { predicate },
  )
}

function applySelfCareCompletionToCache(
  queryClient: QueryClient,
  workspaceId: string,
  completion: SelfCareCompletion,
): void {
  setSelfCareQueriesData<SelfCareDashboardResponse>(
    queryClient,
    workspaceId,
    'dashboard',
    (current) => ({
      ...current,
      flexibleGoals: updateSelfCareEntriesWithCompletion(
        current.flexibleGoals,
        completion,
      ),
      overdueItems: updateSelfCareEntriesWithCompletion(
        current.overdueItems,
        completion,
      ),
      planningHints: updateSelfCareEntriesWithCompletion(
        current.planningHints,
        completion,
      ),
      todayItems: updateSelfCareEntriesWithCompletion(
        current.todayItems,
        completion,
      ),
      upcomingImportant: updateSelfCareEntriesWithCompletion(
        current.upcomingImportant,
        completion,
      ),
    }),
  )

  setSelfCareQueriesData<SelfCarePlanResponse>(
    queryClient,
    workspaceId,
    'plan',
    (current) => ({
      ...current,
      courses: updateSelfCareEntriesWithCompletion(current.courses, completion),
      medical: updateSelfCareEntriesWithCompletion(current.medical, completion),
      occurrences: updateSelfCareEntriesWithCompletion(
        current.occurrences,
        completion,
      ),
      planningHints: updateSelfCareEntriesWithCompletion(
        current.planningHints,
        completion,
      ),
    }),
  )

  updateSelfCareHistoryQueries(queryClient, workspaceId, completion)
}

function applySelfCareOccurrenceToCache(
  queryClient: QueryClient,
  workspaceId: string,
  occurrence: SelfCareOccurrence,
): void {
  setSelfCareQueriesData<SelfCareDashboardResponse>(
    queryClient,
    workspaceId,
    'dashboard',
    (current) => ({
      ...current,
      flexibleGoals: replaceSelfCareOccurrence(
        current.flexibleGoals,
        occurrence,
      ),
      overdueItems: replaceSelfCareOccurrence(current.overdueItems, occurrence),
      planningHints: replaceSelfCareOccurrence(
        current.planningHints,
        occurrence,
      ),
      todayItems: replaceSelfCareOccurrence(current.todayItems, occurrence),
      upcomingImportant: replaceSelfCareOccurrence(
        current.upcomingImportant,
        occurrence,
      ),
    }),
  )

  setSelfCareQueriesData<SelfCarePlanResponse>(
    queryClient,
    workspaceId,
    'plan',
    (current) => ({
      ...current,
      courses: replaceSelfCareOccurrence(current.courses, occurrence),
      medical: replaceSelfCareOccurrence(current.medical, occurrence),
      occurrences: replaceSelfCareOccurrence(current.occurrences, occurrence),
      planningHints: replaceSelfCareOccurrence(
        current.planningHints,
        occurrence,
      ),
    }),
  )
}

function setSelfCareQueriesData<TData>(
  queryClient: QueryClient,
  workspaceId: string,
  scope: SelfCareQueryScope,
  updater: (current: TData) => TData,
): void {
  queryClient.setQueriesData<TData>(
    {
      predicate: (query) =>
        isSelfCareQueryForScope(query.queryKey, workspaceId, scope),
    },
    (current) => (current ? updater(current) : current),
  )
}

function updateSelfCareHistoryQueries(
  queryClient: QueryClient,
  workspaceId: string,
  completion: SelfCareCompletion,
): void {
  const completionDate = completion.completedAt.slice(0, 10)
  const queries = queryClient.getQueryCache().findAll({
    predicate: (query) => {
      const key = query.queryKey
      return (
        isSelfCareQueryForScope(key, workspaceId, 'history') &&
        typeof key[3] === 'string' &&
        typeof key[4] === 'string' &&
        completionDate >= key[3] &&
        completionDate <= key[4]
      )
    },
  })

  for (const query of queries) {
    queryClient.setQueryData<SelfCareHistoryResponse>(
      query.queryKey,
      (current) =>
        current
          ? {
              ...current,
              completions: upsertSelfCareCompletion(
                current.completions,
                completion,
              ),
            }
          : current,
    )
  }
}

function updateSelfCareEntriesWithCompletion(
  entries: SelfCareTodayItem[],
  completion: SelfCareCompletion,
): SelfCareTodayItem[] {
  return entries.map((entry) =>
    updateSelfCareEntryWithCompletion(entry, completion),
  )
}

function updateSelfCareEntryWithCompletion(
  entry: SelfCareTodayItem,
  completion: SelfCareCompletion,
): SelfCareTodayItem {
  if (completion.occurrenceId) {
    if (entry.occurrence?.id !== completion.occurrenceId) {
      return entry
    }

    return withSelfCareEntryCompletion(
      {
        ...entry,
        occurrence: {
          ...entry.occurrence,
          completedAt: isProgressSelfCareCompletion(completion)
            ? completion.completedAt
            : entry.occurrence.completedAt,
          status: mapCompletionStatusToOccurrenceStatus(completion.status),
        },
      },
      completion,
    )
  }

  if (entry.item.id !== completion.itemId || entry.occurrence) {
    return entry
  }

  if (isFlexibleGoalEntry(entry)) {
    return updateSelfCareFlexibleProgress(entry, completion)
  }

  return withSelfCareEntryCompletion(entry, completion)
}

function withSelfCareEntryCompletion(
  entry: SelfCareTodayItem,
  completion: SelfCareCompletion,
): SelfCareTodayItem {
  return updateSelfCareCourseProgress(
    {
      ...entry,
      completion,
      lastExercise:
        entry.item.type === 'exercise' && completion.measurementValue !== null
          ? completion
          : entry.lastExercise,
      lastMeasurement:
        entry.item.type === 'measurement' &&
        completion.measurementValue !== null
          ? completion
          : entry.lastMeasurement,
    },
    completion,
  )
}

function updateSelfCareFlexibleProgress(
  entry: SelfCareTodayItem,
  completion: SelfCareCompletion,
): SelfCareTodayItem {
  if (
    !entry.flexibleProgress ||
    !isProgressSelfCareCompletion(completion) ||
    !isCompletionInFlexibleProgressPeriod(completion, entry.flexibleProgress)
  ) {
    return entry
  }

  const completedCount = Math.min(
    entry.flexibleProgress.targetCount,
    entry.flexibleProgress.completedCount + 1,
  )

  return {
    ...entry,
    flexibleProgress: {
      ...entry.flexibleProgress,
      completedCount,
      remainingCount: Math.max(
        0,
        entry.flexibleProgress.targetCount - completedCount,
      ),
    },
  }
}

function updateSelfCareCourseProgress(
  entry: SelfCareTodayItem,
  completion: SelfCareCompletion,
): SelfCareTodayItem {
  if (
    entry.item.type !== 'course' ||
    !entry.courseDetails ||
    !isProgressSelfCareCompletion(completion)
  ) {
    return entry
  }

  const completedCount = Math.min(
    entry.courseDetails.totalCount,
    entry.courseDetails.completedCount + 1,
  )

  return {
    ...entry,
    courseDetails: {
      ...entry.courseDetails,
      completedCount,
      isCompleted: completedCount >= entry.courseDetails.totalCount,
    },
  }
}

function replaceSelfCareOccurrence(
  entries: SelfCareTodayItem[],
  occurrence: SelfCareOccurrence,
): SelfCareTodayItem[] {
  return entries.map((entry) =>
    entry.occurrence?.id === occurrence.id ? { ...entry, occurrence } : entry,
  )
}

function upsertSelfCareCompletion(
  completions: SelfCareCompletion[],
  completion: SelfCareCompletion,
): SelfCareCompletion[] {
  const withoutCurrent = completions.filter(
    (candidate) => candidate.id !== completion.id,
  )
  return [...withoutCurrent, completion].sort((left, right) =>
    right.completedAt.localeCompare(left.completedAt),
  )
}

function isSelfCareQueryForScope(
  queryKey: readonly unknown[],
  workspaceId: string,
  scope: SelfCareQueryScope,
): boolean {
  return (
    Array.isArray(queryKey) &&
    queryKey[0] === 'self-care' &&
    queryKey[1] === workspaceId &&
    queryKey[2] === scope
  )
}

function mapCompletionStatusToOccurrenceStatus(
  status: SelfCareCompletion['status'],
): SelfCareOccurrenceStatus {
  return status === 'alternative_done' ? 'partial' : status
}

function isProgressSelfCareCompletion(completion: SelfCareCompletion): boolean {
  return (
    completion.status === 'done' ||
    completion.status === 'partial' ||
    completion.status === 'alternative_done'
  )
}

function isFlexibleGoalEntry(entry: SelfCareTodayItem): boolean {
  return (
    entry.item.type === 'flexible_goal' ||
    entry.scheduleRule?.repeatKind === 'flexible_goal'
  )
}

function isCompletionInFlexibleProgressPeriod(
  completion: SelfCareCompletion,
  progress: NonNullable<SelfCareTodayItem['flexibleProgress']>,
): boolean {
  const date = completion.completedAt.slice(0, 10)
  return date >= progress.periodStart && date <= progress.periodEnd
}

function setRitualStepDraftQueryData(
  queryClient: QueryClient,
  workspaceId: string,
  result: SelfCareRitualStepDraftListResponse,
): void {
  queryClient.setQueryData(
    selfCareRitualStepDraftsQueryKey(workspaceId, result.date),
    result,
  )
}

async function invalidateMigratedHabitRoutine(
  queryClient: QueryClient,
  workspaceId: string,
  habitId: string | null,
): Promise<void> {
  if (!habitId) {
    return
  }

  queryClient.setQueriesData<HabitTodayResponse>(
    {
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        query.queryKey[0] === 'habits' &&
        query.queryKey[1] === workspaceId &&
        query.queryKey[2] === 'today',
    },
    (current) =>
      current
        ? {
            ...current,
            items: current.items.filter((item) => item.habit.id !== habitId),
          }
        : current,
  )

  await queryClient.invalidateQueries({
    queryKey: ['habits', workspaceId],
  })
}
