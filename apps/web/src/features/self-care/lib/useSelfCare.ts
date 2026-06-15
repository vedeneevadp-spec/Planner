import {
  type SelfCareCompletionInput,
  type SelfCareDailyStateInput,
  type SelfCareItemInput,
  type SelfCareItemScheduleInput,
  type SelfCareItemUpdateInput,
  type SelfCareMinimumItemsUpdateInput,
  type SelfCareOccurrenceMoveInput,
  type SelfCareOccurrenceSkipInput,
  type SelfCareRitualCompletionInput,
  type SelfCareSettingsUpdateInput,
  type SelfCareTemplateCreateInput,
} from '@planner/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useSessionFeatureReadiness } from '@/features/session'
import { addDays, getDateKey } from '@/shared/lib/date'

import {
  createSelfCareApiClient,
  type SelfCareApiClient,
  SelfCareApiError,
} from './self-care-api'

interface OccurrenceMutationVariables<TInput> {
  input?: TInput | undefined
  occurrenceId: string
}

interface RequiredOccurrenceMutationVariables<TInput> {
  input: TInput
  occurrenceId: string
}

interface ItemCompletionVariables<TInput> {
  input?: TInput | undefined
  itemId: string
}

interface ItemScheduleVariables {
  input: SelfCareItemScheduleInput
  itemId: string
}

interface ItemUpdateVariables {
  input: SelfCareItemUpdateInput
  itemId: string
}

interface CreateFromTemplateVariables {
  input?: SelfCareTemplateCreateInput | undefined
  templateId: string
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
  date = getDateKey(new Date()),
  options: { enabled?: boolean } = {},
) {
  const { api, isEnabled, workspaceId } = useSelfCareApi(options)
  const queryKey = useMemo(
    () => selfCareDashboardQueryKey(workspaceId, date),
    [date, workspaceId],
  )

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) => requireSelfCareApi(api).getDashboard(date, signal),
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
  from = getDateKey(new Date()),
  to = getDateKey(addDays(new Date(), 45)),
  options: { enabled?: boolean } = {},
) {
  const { api, isEnabled, workspaceId } = useSelfCareApi(options)
  const queryKey = useMemo(
    () => selfCarePlanQueryKey(workspaceId, from, to),
    [from, to, workspaceId],
  )

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) => requireSelfCareApi(api).getPlan(from, to, signal),
    queryKey,
    staleTime: 30_000,
  })
}

export function useSelfCareHistory(
  from = getDateKey(addDays(new Date(), -30)),
  to = getDateKey(new Date()),
  options: { enabled?: boolean } = {},
) {
  const { api, isEnabled, workspaceId } = useSelfCareApi(options)
  const queryKey = useMemo(
    () => selfCareHistoryQueryKey(workspaceId, from, to),
    [from, to, workspaceId],
  )

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) =>
      requireSelfCareApi(api).getHistory(from, to, signal),
    queryKey,
    staleTime: 30_000,
  })
}

export function useSelfCareAnalytics(
  from = getDateKey(addDays(new Date(), -30)),
  to = getDateKey(new Date()),
  options: { enabled?: boolean } = {},
) {
  const { api, isEnabled, workspaceId } = useSelfCareApi(options)
  const queryKey = useMemo(
    () => selfCareAnalyticsQueryKey(workspaceId, from, to),
    [from, to, workspaceId],
  )

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) =>
      requireSelfCareApi(api).getAnalytics(from, to, signal),
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
    mutationFn: async (input: SelfCareItemInput) => {
      assertSession(session, 'создать заботу')
      const item = await requireSelfCareApi(api).createItem(input)
      await invalidateSelfCare(queryClient, workspaceId)
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
      await invalidateSelfCare(queryClient, workspaceId)
      return item
    },
  })
}

export function useUpdateSelfCareItem() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async ({ input, itemId }: ItemUpdateVariables) => {
      assertSession(session, 'обновить заботу')
      const item = await requireSelfCareApi(api).updateItem(itemId, input)
      await invalidateSelfCare(queryClient, workspaceId)
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
      await invalidateSelfCare(queryClient, workspaceId)
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
      await invalidateSelfCare(queryClient, workspaceId)
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
      await invalidateSelfCare(queryClient, workspaceId)
      return completion
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
      await invalidateSelfCare(queryClient, workspaceId)
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
      await invalidateSelfCare(queryClient, workspaceId)
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
      await invalidateSelfCare(queryClient, workspaceId)
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
      await invalidateSelfCare(queryClient, workspaceId)
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
      occurrenceId,
    }: RequiredOccurrenceMutationVariables<SelfCareOccurrenceMoveInput>) => {
      assertSession(session, 'перенести заботу')
      const occurrence = await requireSelfCareApi(api).moveOccurrence(
        occurrenceId,
        input,
      )
      await invalidateSelfCare(queryClient, workspaceId)
      return occurrence
    },
  })
}

export function useScheduleSelfCareItem() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useSelfCareApi()

  return useMutation({
    mutationFn: async ({ input, itemId }: ItemScheduleVariables) => {
      assertSession(session, 'запланировать заботу')
      const occurrence = await requireSelfCareApi(api).scheduleItem(
        itemId,
        input,
      )
      await invalidateSelfCare(queryClient, workspaceId)
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
      await invalidateSelfCare(queryClient, workspaceId)
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
      await invalidateSelfCare(queryClient, workspaceId)
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
      await invalidateSelfCare(queryClient, workspaceId)
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
      await invalidateSelfCare(queryClient, workspaceId)
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
      await invalidateSelfCare(queryClient, workspaceId)
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
    isEnabled: isApiEnabled,
    session,
    workspaceId,
  }
}

function requireSelfCareApi(api: SelfCareApiClient | null): SelfCareApiClient {
  if (!api) {
    throw new Error('Self-care API is not ready.')
  }

  return api
}

function assertSession(session: unknown, action: string): void {
  if (!session) {
    throw new Error(`Planner session is required to ${action}.`)
  }
}

async function invalidateSelfCare(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    predicate: (query) =>
      Array.isArray(query.queryKey) &&
      query.queryKey[0] === 'self-care' &&
      query.queryKey[1] === workspaceId,
  })
}
