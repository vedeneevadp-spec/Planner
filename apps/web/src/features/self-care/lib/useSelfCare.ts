import {
  type HabitTodayResponse,
  type SelfCareCompletionInput,
  type SelfCareDailyStateInput,
  type SelfCareItemInput,
  type SelfCareItemScheduleInput,
  type SelfCareItemUpdateInput,
  type SelfCareMinimumItemsUpdateInput,
  type SelfCareOccurrenceMoveInput,
  type SelfCareOccurrenceSkipInput,
  type SelfCareRitualCompletionInput,
  type SelfCareRitualStepDraftInput,
  type SelfCareRitualStepDraftListResponse,
  type SelfCareSettingsUpdateInput,
  type SelfCareTemplateCreateInput,
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
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_OCCURRENCE_CHANGE_SCOPES,
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
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_COMPLETION_CHANGE_SCOPES,
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
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_OCCURRENCE_CHANGE_SCOPES,
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
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_COMPLETION_CHANGE_SCOPES,
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
      queueSelfCareInvalidation(
        queryClient,
        workspaceId,
        SELF_CARE_OCCURRENCE_CHANGE_SCOPES,
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
    throw new Error(
      'Сессия еще не готова. Подожди пару секунд и попробуй снова.',
    )
  }

  return api
}

function assertSession(session: unknown, action: string): void {
  if (!session) {
    throw new Error(`Planner session is required to ${action}.`)
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
  options: { skipInvalidation?: boolean | undefined } = {},
): void {
  if (options.skipInvalidation) {
    return
  }

  queueSelfCareInvalidation(queryClient, workspaceId, scopes)
}

function queueSelfCareInvalidation(
  queryClient: QueryClient,
  workspaceId: string,
  scopes: readonly SelfCareQueryScope[],
): void {
  const scopeSet = new Set<SelfCareQueryScope>(scopes)

  void queryClient.invalidateQueries({
    predicate: (query) =>
      Array.isArray(query.queryKey) &&
      query.queryKey[0] === 'self-care' &&
      query.queryKey[1] === workspaceId &&
      typeof query.queryKey[2] === 'string' &&
      scopeSet.has(query.queryKey[2] as SelfCareQueryScope),
  })
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
