import {
  generateUuidV7,
  type HabitTodayResponse,
  type SelfCareAnalyticsResponse,
  type SelfCareCompletion,
  type SelfCareCompletionInput,
  type SelfCareCompletionUpdateInput,
  type SelfCareDashboardResponse,
  type SelfCareHistoryResponse,
  type SelfCareItem,
  type SelfCareItemInput,
  type SelfCareItemScheduleInput,
  type SelfCareItemUpdateInput,
  type SelfCareListResponse,
  type SelfCareOccurrence,
  type SelfCareOccurrenceMoveInput,
  type SelfCareOccurrenceSkipInput,
  type SelfCareOfflineCommand,
  type SelfCareOfflineCommandResult,
  selfCareOfflineCommandSchema,
  type SelfCarePlanResponse,
  type SelfCareRitualCompletionInput,
  type SelfCareRitualStepDraftInput,
  type SelfCareRitualStepDraftListResponse,
  type SelfCareSettingsResponse,
  type SelfCareSettingsUpdateInput,
  type SelfCareTemplate,
  type SelfCareTemplateCreateInput,
  type SelfCareTodayItem,
  type SessionResponse,
} from '@planner/contracts'
import {
  type QueryClient,
  useMutation as useTanstackMutation,
  type UseMutationOptions,
  type UseMutationResult,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  usePlannerTimeZone,
  useSessionFeatureReadiness,
} from '@/features/session'
import {
  isBrowserRetryableOfflineError,
  useOfflineQueueDrain,
} from '@/shared/lib/offline-sync'
import { addDateDays, getTodayDate } from '@/shared/time/time.service'

import {
  cancelSelfCareOfflineMutation,
  commitSelfCareOfflineMutationResult,
  completeSelfCareOfflineMutation,
  countSelfCareOfflineMutations,
  createSelfCareCacheKey,
  enqueueSelfCareOfflineMutation,
  getSelfCareOfflineStorageHealth,
  getSelfCareOfflineWorkspaceWriteGeneration,
  isSelfCareOfflineStorageAvailable,
  isSelfCareOfflineWorkspaceWriteGenerationCurrent,
  listSelfCareOfflineMutations,
  loadCachedSelfCareRead,
  loadConfirmedSelfCareCachedScopes,
  loadProjectedCachedSelfCareRead,
  probeSelfCareOfflineStorage,
  rebaseSelfCareOfflineMutations,
  reportSelfCareOfflineStorageFailure,
  saveCachedSelfCareRead,
  type SelfCareCachedRead,
  type SelfCareOfflineMutationRecord,
  type SelfCareOfflineOverlay,
  subscribeSelfCareOfflineQueue,
} from './offline-self-care-store'
import {
  createSelfCareApiClient,
  type SelfCareApiClient,
  SelfCareApiError,
} from './self-care-api'
import {
  createOptimisticSelfCareResult,
  findSelfCareCompletion,
  findSelfCareItem,
  findSelfCareOccurrence,
  SelfCareOfflineBaseUnavailableError,
  type SelfCareOptimisticSource,
} from './self-care-offline-command'
import {
  getSelfCareCommandEntityKeys,
  getSelfCareResultEntityKeys,
  projectSelfCareCachedRead,
  projectSelfCareRead,
} from './self-care-offline-projection'
import { drainSelfCareOfflineQueue } from './self-care-offline-sync'

interface OccurrenceMutationVariables<TInput> {
  input?: TInput | undefined
  occurrenceId: string
  skipInvalidation?: boolean | undefined
}

interface RequiredOccurrenceMutationVariables<TInput> {
  input: TInput
  invalidationScopes?: readonly SelfCareQueryScope[] | undefined
  occurrenceId: string
  replacementInput?: SelfCareItemScheduleInput | undefined
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
  existingOccurrenceId?: string | undefined
  input: SelfCareItemScheduleInput
  invalidationScopes?: readonly SelfCareQueryScope[] | undefined
  itemId: string
  skipInvalidation?: boolean | undefined
}

interface ItemUpdateVariables {
  entry?: SelfCareTodayItem | undefined
  input: SelfCareItemUpdateInput
  itemId: string
  moveNote?: string | undefined
  scheduleInput?: SelfCareItemScheduleInput | undefined
  skipInvalidation?: boolean | undefined
}

interface CreateItemVariables {
  input: SelfCareItemInput
  scheduleInput?: SelfCareItemScheduleInput | undefined
  skipInvalidation?: boolean | undefined
}

interface CreateFromTemplateVariables {
  input?: SelfCareTemplateCreateInput | undefined
  scheduleInput?: SelfCareItemScheduleInput | undefined
  templateId: string
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

function useMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TOnMutateResult = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TOnMutateResult>,
): UseMutationResult<TData, TError, TVariables, TOnMutateResult> {
  return useTanstackMutation({ ...options, networkMode: 'always' })
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
  'Сейчас не удалось надёжно сохранить изменение. Проверь доступ к профилю или подключение и попробуй снова.'

export const SELF_CARE_NETWORK_ERROR_MESSAGE =
  'Не удалось связаться с сервером, и сохранить изменение на устройстве тоже не получилось. Проверь подключение и попробуй снова.'

export class SelfCareApiUnavailableError extends Error {
  constructor() {
    super(SELF_CARE_API_UNAVAILABLE_MESSAGE)
    this.name = 'SelfCareApiUnavailableError'
  }
}

declare const selfCareQueryOwnerIdBrand: unique symbol

export type SelfCareQueryOwnerId = string & {
  readonly [selfCareQueryOwnerIdBrand]: true
}

export function createSelfCareQueryOwnerId(
  workspaceId: string,
  actorUserId: string,
): SelfCareQueryOwnerId {
  return JSON.stringify([workspaceId, actorUserId]) as SelfCareQueryOwnerId
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

export function selfCareDashboardQueryKey(
  workspaceId: SelfCareQueryOwnerId,
  date: string,
) {
  return ['self-care', workspaceId, 'dashboard', date] as const
}

export function selfCareItemsQueryKey(workspaceId: SelfCareQueryOwnerId) {
  return ['self-care', workspaceId, 'items'] as const
}

export function selfCarePlanQueryKey(
  workspaceId: SelfCareQueryOwnerId,
  from: string,
  to: string,
) {
  return ['self-care', workspaceId, 'plan', from, to] as const
}

export function selfCareRitualStepDraftsQueryKey(
  workspaceId: SelfCareQueryOwnerId,
  date: string,
) {
  return ['self-care', workspaceId, 'ritual-step-drafts', date] as const
}

export function selfCareHistoryQueryKey(
  workspaceId: SelfCareQueryOwnerId,
  from: string,
  to: string,
) {
  return ['self-care', workspaceId, 'history', from, to] as const
}

export function selfCareAnalyticsQueryKey(
  workspaceId: SelfCareQueryOwnerId,
  from: string,
  to: string,
) {
  return ['self-care', workspaceId, 'analytics', from, to] as const
}

export function selfCareSettingsQueryKey(workspaceId: SelfCareQueryOwnerId) {
  return ['self-care', workspaceId, 'settings'] as const
}

export function selfCareTemplatesQueryKey(workspaceId: SelfCareQueryOwnerId) {
  return ['self-care', workspaceId, 'templates'] as const
}

export function useSelfCareDashboard(
  date?: string,
  options: { enabled?: boolean } = {},
) {
  const plannerTimeZone = usePlannerTimeZone()
  const resolvedDate = date ?? getTodayDate(plannerTimeZone)

  return usePersistentSelfCareQuery<SelfCareDashboardResponse>({
    cacheParameters: [resolvedDate],
    enabled: options.enabled,
    queryKey: (workspaceId) =>
      selfCareDashboardQueryKey(workspaceId, resolvedDate),
    request: (api, signal) => api.getDashboard(resolvedDate, signal),
    scope: 'dashboard',
    staleTime: 20_000,
  })
}

export function useSelfCareItems(options: { enabled?: boolean } = {}) {
  return usePersistentSelfCareQuery<SelfCareListResponse>({
    enabled: options.enabled,
    queryKey: selfCareItemsQueryKey,
    request: (api, signal) => api.listItems({}, signal),
    scope: 'items',
    staleTime: 30_000,
  })
}

export function useSelfCarePlan(
  from?: string,
  to?: string,
  options: { enabled?: boolean } = {},
) {
  const plannerTimeZone = usePlannerTimeZone()
  const resolvedFrom = from ?? getTodayDate(plannerTimeZone)
  const resolvedTo = to ?? addDateDays(resolvedFrom, 45)

  return usePersistentSelfCareQuery<SelfCarePlanResponse>({
    cacheParameters: [resolvedFrom, resolvedTo],
    enabled: options.enabled,
    queryKey: (workspaceId) =>
      selfCarePlanQueryKey(workspaceId, resolvedFrom, resolvedTo),
    request: (api, signal) => api.getPlan(resolvedFrom, resolvedTo, signal),
    scope: 'plan',
    staleTime: 30_000,
  })
}

export function useSelfCareRitualStepDrafts(
  date?: string,
  options: { enabled?: boolean } = {},
) {
  const plannerTimeZone = usePlannerTimeZone()
  const resolvedDate = date ?? getTodayDate(plannerTimeZone)

  return usePersistentSelfCareQuery<SelfCareRitualStepDraftListResponse>({
    cacheParameters: [resolvedDate],
    enabled: options.enabled,
    queryKey: (workspaceId) =>
      selfCareRitualStepDraftsQueryKey(workspaceId, resolvedDate),
    request: (api, signal) => api.getRitualStepDrafts(resolvedDate, signal),
    scope: 'ritual-step-drafts',
    staleTime: 20_000,
  })
}

export function useSelfCareHistory(
  from?: string,
  to?: string,
  options: { enabled?: boolean } = {},
) {
  const plannerTimeZone = usePlannerTimeZone()
  const resolvedTo = to ?? getTodayDate(plannerTimeZone)
  const resolvedFrom = from ?? addDateDays(resolvedTo, -30)

  return usePersistentSelfCareQuery<SelfCareHistoryResponse>({
    cacheParameters: [resolvedFrom, resolvedTo],
    enabled: options.enabled,
    queryKey: (workspaceId) =>
      selfCareHistoryQueryKey(workspaceId, resolvedFrom, resolvedTo),
    request: (api, signal) => api.getHistory(resolvedFrom, resolvedTo, signal),
    scope: 'history',
    staleTime: 30_000,
  })
}

export function useSelfCareAnalytics(
  from?: string,
  to?: string,
  options: { enabled?: boolean } = {},
) {
  const plannerTimeZone = usePlannerTimeZone()
  const resolvedTo = to ?? getTodayDate(plannerTimeZone)
  const resolvedFrom = from ?? addDateDays(resolvedTo, -30)

  return usePersistentSelfCareQuery<SelfCareAnalyticsResponse>({
    cacheParameters: [resolvedFrom, resolvedTo],
    enabled: options.enabled,
    queryKey: (workspaceId) =>
      selfCareAnalyticsQueryKey(workspaceId, resolvedFrom, resolvedTo),
    request: (api, signal) =>
      api.getAnalytics(resolvedFrom, resolvedTo, signal),
    scope: 'analytics',
    staleTime: 30_000,
  })
}

export function useSelfCareSettings(options: { enabled?: boolean } = {}) {
  return usePersistentSelfCareQuery<SelfCareSettingsResponse>({
    enabled: options.enabled,
    queryKey: selfCareSettingsQueryKey,
    request: (api, signal) => api.getSettings(signal),
    scope: 'settings',
    staleTime: 30_000,
  })
}

export function useSelfCareTemplates(options: { enabled?: boolean } = {}) {
  return usePersistentSelfCareQuery<SelfCareTemplate[]>({
    enabled: options.enabled,
    queryKey: selfCareTemplatesQueryKey,
    request: (api, signal) => api.listTemplates(signal),
    scope: 'templates',
    staleTime: 300_000,
  })
}

const EMPTY_SELF_CARE_OFFLINE_QUEUE_COUNTS = {
  awaitingRefresh: 0,
  conflicted: 0,
  failed: 0,
  pending: 0,
  total: 0,
}

export function useSelfCareOfflineQueue() {
  const queryClient = useQueryClient()
  const context = useSelfCareApi()
  const scopeIdentity = `${context.storageWorkspaceId}\u0000${context.actorUserId}`
  const scopeToken = useMemo(() => Symbol(scopeIdentity), [scopeIdentity])
  const [countsByScope, setCountsByScope] = useState(
    () =>
      new Map([[scopeToken, EMPTY_SELF_CARE_OFFLINE_QUEUE_COUNTS]] as const),
  )
  const [drainingByScope, setDrainingByScope] = useState(
    () => new Map<symbol, boolean>([[scopeToken, false]]),
  )
  const [storageHealth, setStorageHealth] = useState(
    getSelfCareOfflineStorageHealth,
  )
  const setScopeCounts = useCallback(
    (counts: typeof EMPTY_SELF_CARE_OFFLINE_QUEUE_COUNTS) => {
      setCountsByScope((current) => {
        const next = new Map(current)
        next.set(scopeToken, counts)
        return next
      })
    },
    [scopeToken],
  )
  const setScopeDraining = useCallback(
    (isDraining: boolean) => {
      setDrainingByScope((current) => {
        const next = new Map(current)
        next.set(scopeToken, isDraining)
        return next
      })
    },
    [scopeToken],
  )
  const refreshCounts = useCallback(
    async (shouldCommit: () => boolean = () => true) => {
      if (
        context.storageWorkspaceId === 'pending' ||
        context.actorUserId === 'pending'
      ) {
        if (shouldCommit()) {
          setScopeCounts(EMPTY_SELF_CARE_OFFLINE_QUEUE_COUNTS)
        }
        return
      }

      try {
        const counts = await countSelfCareOfflineMutations(
          context.storageWorkspaceId,
          context.actorUserId,
        )

        if (shouldCommit()) {
          setScopeCounts(counts)
        }
      } catch (error) {
        reportSelfCareOfflineStorageFailure(error)

        if (shouldCommit()) {
          setStorageHealth(getSelfCareOfflineStorageHealth())
        }
        console.warn('Failed to read the self-care offline queue.', error)
      }
    },
    [context.actorUserId, context.storageWorkspaceId, setScopeCounts],
  )
  const reconcileAwaiting = useCallback(async () => {
    const mutations = await listSelfCareOfflineMutations(
      context.storageWorkspaceId,
      context.actorUserId,
    )

    for (const mutation of mutations) {
      if (mutation.status !== 'awaiting_refresh' || !mutation.serverResult) {
        continue
      }

      await reconcileAcknowledgedSelfCareMutation(
        mutation,
        mutation.serverResult,
        context,
      )
    }
  }, [context])
  const drain = useCallback(async () => {
    if (
      !context.api ||
      !context.readiness.canWriteProtectedData ||
      context.storageWorkspaceId === 'pending' ||
      context.actorUserId === 'pending' ||
      (typeof navigator !== 'undefined' && navigator.onLine === false)
    ) {
      await refreshCounts()
      return null
    }

    setScopeDraining(true)
    try {
      await reconcileAwaiting()
      const result = await drainSelfCareOfflineQueue({
        actorUserId: context.actorUserId,
        api: context.api,
        onApplied: async ({ mutation, response }) => {
          await reconcileAcknowledgedSelfCareMutation(
            mutation,
            response.result,
            context,
          )
        },
        workspaceId: context.storageWorkspaceId,
      })
      await hydrateSelfCareQueriesFromCache(queryClient, context)
      await refreshCounts()
      return result
    } catch (error) {
      const isStorageFailure = reportSelfCareOfflineStorageFailure(error)
      setStorageHealth(getSelfCareOfflineStorageHealth())

      if (isStorageFailure) {
        return null
      }

      throw error
    } finally {
      setScopeDraining(false)
    }
  }, [context, queryClient, reconcileAwaiting, refreshCounts, setScopeDraining])
  const discardConflicts = useCallback(async () => {
    const mutations = await listSelfCareOfflineMutations(
      context.storageWorkspaceId,
      context.actorUserId,
    )
    await Promise.all(
      mutations
        .filter((mutation) => mutation.status === 'conflicted')
        .map((mutation) =>
          cancelSelfCareOfflineMutation(
            mutation.id,
            context.storageWorkspaceId,
            context.actorUserId,
          ),
        ),
    )
    await hydrateSelfCareQueriesFromCache(queryClient, context)
    await refreshCounts()
  }, [context, queryClient, refreshCounts])
  const refreshAndRetryConflicts = useCallback(async () => {
    if (
      !context.api ||
      !context.readiness.canWriteProtectedData ||
      (typeof navigator !== 'undefined' && navigator.onLine === false)
    ) {
      await refreshCounts()
      return null
    }

    await queryClient.refetchQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        query.queryKey[0] === 'self-care' &&
        query.queryKey[1] === context.workspaceId,
    })
    await rebaseConflictedSelfCareMutations(context)
    return drain()
  }, [context, drain, queryClient, refreshCounts])

  useEffect(() => {
    let isActive = true
    const shouldCommit = () => isActive
    const updateStorageHealth = (
      health: ReturnType<typeof getSelfCareOfflineStorageHealth>,
    ) => {
      if (isActive) {
        setStorageHealth(health)
      }
    }

    void probeSelfCareOfflineStorage().then(updateStorageHealth)
    void Promise.resolve().then(() => refreshCounts(shouldCommit))
    void Promise.resolve()
      .then(reconcileAwaiting)
      .then(() =>
        isActive
          ? hydrateSelfCareQueriesFromCache(queryClient, context)
          : undefined,
      )
      .catch((error) => {
        reportSelfCareOfflineStorageFailure(error)

        if (isActive) {
          setStorageHealth(getSelfCareOfflineStorageHealth())
        }
        console.warn('Failed to reconcile the self-care offline queue.', error)
      })

    const unsubscribe = subscribeSelfCareOfflineQueue(() => {
      const nextHealth = getSelfCareOfflineStorageHealth()
      updateStorageHealth(nextHealth)

      if (nextHealth === 'unknown') {
        void probeSelfCareOfflineStorage().then(updateStorageHealth)
      }

      void refreshCounts(shouldCommit)
    })

    return () => {
      isActive = false
      unsubscribe()
    }
  }, [context, queryClient, reconcileAwaiting, refreshCounts])

  useOfflineQueueDrain({
    drain,
    enabled:
      context.canQueueOfflineWrites &&
      context.readiness.canWriteProtectedData &&
      Boolean(context.api) &&
      storageHealth === 'ready',
  })

  return {
    ...(countsByScope.get(scopeToken) ?? EMPTY_SELF_CARE_OFFLINE_QUEUE_COUNTS),
    canQueueWrites:
      context.canQueueOfflineWrites &&
      storageHealth === 'ready' &&
      isSelfCareOfflineStorageAvailable(),
    canWriteFromSession: context.canQueueOfflineWrites,
    discardConflicts,
    isDraining: drainingByScope.get(scopeToken) ?? false,
    refreshAndRetryConflicts,
    retry: drain,
  }
}

export function useCreateSelfCareItem() {
  return useSelfCareCommandMutation({
    buildCommand: (
      variables: SelfCareItemInput | CreateItemVariables,
      source,
    ) => {
      const { input, scheduleInput } = normalizeCreateItemVariables(variables)
      const itemId = input.id ?? generateUuidV7()
      return {
        ...(scheduleInput
          ? {
              initialSchedule: {
                input: scheduleInput,
                occurrenceId: generateUuidV7(),
              },
            }
          : {}),
        input: normalizeSelfCareItemRelationIds(
          { ...input, id: itemId },
          source.list,
          itemId,
        ),
        type: 'create_item',
      }
    },
    getInvalidationOptions: (variables) => ({
      skipInvalidation:
        normalizeCreateItemVariables(variables).skipInvalidation,
    }),
    scopes: SELF_CARE_ITEM_CHANGE_SCOPES,
    selectResult: selectItemResult,
  })
}

export function useCreateSelfCareItemFromTemplate() {
  return useSelfCareCommandMutation({
    buildCommand: (
      { input, scheduleInput, templateId }: CreateFromTemplateVariables,
      source,
    ) => {
      const itemId = generateUuidV7()
      const template = source.templates?.find(
        (candidate) => candidate.id === templateId,
      )
      const overrides = input?.overrides ?? {}
      return {
        ...(scheduleInput
          ? {
              initialSchedule: {
                input: scheduleInput,
                occurrenceId: generateUuidV7(),
              },
            }
          : {}),
        itemId,
        overrides: normalizeSelfCareItemRelationIds(
          {
            ...overrides,
            ...(overrides.steps
              ? {}
              : {
                  steps: (template?.defaultSteps ?? []).map((title, order) => ({
                    defaultChecked: false,
                    id: generateUuidV7(),
                    isOptional: false,
                    order,
                    title,
                  })),
                }),
          },
          source.list,
          itemId,
        ),
        templateId,
        type: 'create_item_from_template',
      }
    },
    scopes: SELF_CARE_ITEM_CHANGE_SCOPES,
    selectResult: selectItemResult,
  })
}

export function useUpdateSelfCareItem() {
  return useSelfCareCommandMutation({
    buildCommand: (variables: ItemUpdateVariables, source, occurredAt) => {
      const item = requireSelfCareItemFromSource(source, variables.itemId)
      const { expectedVersion: _ignored, ...rawInput } = variables.input
      const input = normalizeSelfCareItemRelationIds(
        rawInput,
        source.list,
        item.id,
      )
      const occurrence = variables.entry?.occurrence ?? null
      const scheduleChange = variables.scheduleInput
        ? occurrence
          ? variables.scheduleInput.scheduledFor === occurrence.scheduledFor
            ? {
                expectedVersion: occurrence.version,
                input: variables.scheduleInput,
                occurrenceId: occurrence.id,
                type: 'update_schedule',
              }
            : {
                actedAt: occurredAt,
                completionId: generateUuidV7(),
                expectedVersion: occurrence.version,
                input: {
                  newDate: variables.scheduleInput.scheduledFor,
                  note:
                    variables.moveNote ??
                    variables.scheduleInput.note ??
                    'Дата записи изменена.',
                },
                occurrenceId: occurrence.id,
                replacementInput: variables.scheduleInput,
                replacementOccurrenceId: generateUuidV7(),
                type: 'reschedule',
              }
          : {
              input: variables.scheduleInput,
              occurrenceId: generateUuidV7(),
              type: 'schedule',
            }
        : undefined

      return {
        expectedVersion: item.version,
        input,
        itemId: item.id,
        ...(scheduleChange ? { scheduleChange } : {}),
        type: 'update_item',
      }
    },
    getInvalidationOptions: (variables: ItemUpdateVariables) => ({
      skipInvalidation: variables.skipInvalidation,
    }),
    scopes: SELF_CARE_ITEM_CHANGE_SCOPES,
    selectResult: selectItemResult,
  })
}

export function useArchiveSelfCareItem() {
  return useSelfCareCommandMutation({
    afterResult: async (item, { queryClient, storageWorkspaceId }) => {
      await invalidateMigratedHabitRoutine(
        queryClient,
        storageWorkspaceId,
        item.migratedFromHabitId,
      )
    },
    buildCommand: (itemId: string, source) => {
      const item = requireSelfCareItemFromSource(source, itemId)
      return {
        expectedVersion: item.version,
        itemId,
        type: 'archive_item',
      }
    },
    scopes: SELF_CARE_ITEM_CHANGE_SCOPES,
    selectResult: selectItemResult,
  })
}

export function useCancelSelfCareOccurrence() {
  return useSelfCareCommandMutation({
    buildCommand: (occurrenceId: string, source, occurredAt) => {
      const occurrence = requireSelfCareOccurrenceFromSource(
        source,
        occurrenceId,
      )
      return {
        actedAt: occurredAt,
        completionId: generateUuidV7(),
        expectedVersion: occurrence.version,
        occurrenceId,
        type: 'cancel_occurrence',
      }
    },
    invalidationOptions: SELF_CARE_STALE_ONLY_INVALIDATION,
    scopes: SELF_CARE_OCCURRENCE_CHANGE_SCOPES,
    selectResult: selectOccurrenceResult,
  })
}

export function useCompleteSelfCareOccurrence() {
  return useSelfCareCommandMutation({
    buildCommand: (
      {
        input,
        occurrenceId,
      }: OccurrenceMutationVariables<SelfCareRitualCompletionInput>,
      source,
      occurredAt,
    ) => {
      const occurrence = requireSelfCareOccurrenceFromSource(
        source,
        occurrenceId,
      )
      return {
        completionId: generateUuidV7(),
        expectedVersion: occurrence.version,
        input: withCommandCompletionTime(input, occurredAt),
        occurrenceId,
        type: 'complete_occurrence',
      }
    },
    invalidationOptions: SELF_CARE_STALE_ONLY_INVALIDATION,
    scopes: SELF_CARE_COMPLETION_CHANGE_SCOPES,
    selectResult: selectCompletionResult,
  })
}

export function useUpsertSelfCareRitualStepDraft() {
  return useSelfCareCommandMutation({
    buildCommand: (input: SelfCareRitualStepDraftInput, source) => ({
      expectedVersion:
        source.drafts?.drafts.find(
          (draft) =>
            draft.date === input.date &&
            draft.itemId === input.itemId &&
            draft.occurrenceId === input.occurrenceId,
        )?.version ?? null,
      input,
      type: 'upsert_ritual_step_draft',
    }),
    scopes: ['ritual-step-drafts'],
    selectResult: selectRitualStepDraftsResult,
  })
}

export function useCompleteSelfCareItemNow() {
  return useSelfCareCommandMutation({
    buildCommand: (
      { input, itemId }: ItemCompletionVariables<SelfCareRitualCompletionInput>,
      source,
      occurredAt,
    ) => ({
      completionId: generateUuidV7(),
      expectedVersion: requireSelfCareItemFromSource(source, itemId).version,
      input: withCommandCompletionTime(input, occurredAt),
      itemId,
      type: 'complete_item_now',
    }),
    invalidationOptions: SELF_CARE_STALE_ONLY_INVALIDATION,
    scopes: SELF_CARE_COMPLETION_CHANGE_SCOPES,
    selectResult: selectCompletionResult,
  })
}

export function useUpdateSelfCareCompletion() {
  return useSelfCareCommandMutation({
    buildCommand: (
      { completionId, input }: CompletionUpdateVariables,
      source,
    ) => ({
      completionId,
      expectedVersion: requireSelfCareCompletionFromSource(source, completionId)
        .version,
      input,
      type: 'update_completion',
    }),
    scopes: SELF_CARE_COMPLETION_CHANGE_SCOPES,
    selectResult: selectCompletionResult,
  })
}

export function useCompleteSelfCareFlexibleGoal() {
  return useSelfCareCommandMutation({
    buildCommand: (
      { input, itemId }: ItemCompletionVariables<SelfCareCompletionInput>,
      source,
      occurredAt,
    ) => ({
      completionId: generateUuidV7(),
      expectedVersion: requireSelfCareItemFromSource(source, itemId).version,
      input: withCommandCompletionTime(input, occurredAt),
      itemId,
      type: 'complete_flexible_goal',
    }),
    invalidationOptions: SELF_CARE_STALE_ONLY_INVALIDATION,
    scopes: SELF_CARE_COMPLETION_CHANGE_SCOPES,
    selectResult: selectCompletionResult,
  })
}

export function useCompleteSelfCareCourseSession() {
  return useSelfCareCommandMutation({
    buildCommand: (
      { input, itemId }: ItemCompletionVariables<SelfCareCompletionInput>,
      source,
      occurredAt,
    ) => ({
      completionId: generateUuidV7(),
      expectedVersion: requireSelfCareItemFromSource(source, itemId).version,
      input: withCommandCompletionTime(input, occurredAt),
      itemId,
      type: 'complete_course_session',
    }),
    invalidationOptions: SELF_CARE_STALE_ONLY_INVALIDATION,
    scopes: SELF_CARE_COMPLETION_CHANGE_SCOPES,
    selectResult: selectCompletionResult,
  })
}

export function useSkipSelfCareOccurrence() {
  return useSelfCareCommandMutation({
    buildCommand: (
      {
        input,
        occurrenceId,
      }: OccurrenceMutationVariables<SelfCareOccurrenceSkipInput>,
      source,
      occurredAt,
    ) => ({
      actedAt: occurredAt,
      completionId: generateUuidV7(),
      expectedVersion: requireSelfCareOccurrenceFromSource(source, occurrenceId)
        .version,
      input: input ?? {},
      occurrenceId,
      type: 'skip_occurrence',
    }),
    invalidationOptions: SELF_CARE_STALE_ONLY_INVALIDATION,
    scopes: SELF_CARE_OCCURRENCE_CHANGE_SCOPES,
    selectResult: selectOccurrenceResult,
  })
}

export function useMoveSelfCareOccurrence() {
  return useSelfCareCommandMutation({
    buildCommand: (
      variables: RequiredOccurrenceMutationVariables<SelfCareOccurrenceMoveInput>,
      source,
      occurredAt,
    ) => {
      const occurrence = requireSelfCareOccurrenceFromSource(
        source,
        variables.occurrenceId,
      )
      return {
        actedAt: occurredAt,
        completionId: generateUuidV7(),
        expectedVersion: occurrence.version,
        input: variables.input,
        occurrenceId: variables.occurrenceId,
        replacementInput:
          variables.replacementInput ??
          createReplacementScheduleInput(occurrence, variables.input.newDate),
        replacementOccurrenceId: generateUuidV7(),
        type: 'move_occurrence',
      }
    },
    getInvalidationOptions: (variables) => ({
      skipInvalidation: variables.skipInvalidation,
    }),
    getScopes: (variables) =>
      variables.invalidationScopes ?? SELF_CARE_OCCURRENCE_CHANGE_SCOPES,
    selectResult: selectOccurrenceResult,
  })
}

export function useScheduleSelfCareItem() {
  return useSelfCareCommandMutation({
    buildCommand: (
      { existingOccurrenceId, input, itemId }: ItemScheduleVariables,
      source,
    ) => {
      const existingOccurrence = existingOccurrenceId
        ? requireSelfCareOccurrenceFromSource(source, existingOccurrenceId)
        : null

      return {
        ...(existingOccurrence
          ? {
              existingOccurrenceId: existingOccurrence.id,
              expectedOccurrenceVersion: existingOccurrence.version,
            }
          : { occurrenceId: generateUuidV7() }),
        expectedVersion: requireSelfCareItemFromSource(source, itemId).version,
        input,
        itemId,
        type: 'schedule_item',
      }
    },
    getInvalidationOptions: (variables) => ({
      skipInvalidation: variables.skipInvalidation,
    }),
    getScopes: (variables) =>
      variables.invalidationScopes ?? SELF_CARE_ITEM_CHANGE_SCOPES,
    selectResult: selectOccurrenceResult,
  })
}

export function useUpdateSelfCareSettings() {
  return useSelfCareCommandMutation({
    buildCommand: (input: SelfCareSettingsUpdateInput, source) => {
      const settings =
        source.settings?.settings ?? source.dashboard?.settings ?? null

      if (!settings) {
        throw new SelfCareOfflineBaseUnavailableError()
      }

      return {
        expectedVersion: settings.version,
        input,
        type: 'update_settings',
      }
    },
    scopes: SELF_CARE_SETTINGS_CHANGE_SCOPES,
    selectResult: selectSettingsResult,
  })
}

export function getSelfCareErrorMessage(error: unknown): string {
  if (isSelfCareNetworkError(error)) {
    return SELF_CARE_NETWORK_ERROR_MESSAGE
  }

  if (error instanceof SelfCareApiError) {
    if (error.code === 'self_care_request_failed') {
      return 'Не удалось выполнить запрос. Повтори попытку.'
    }

    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Не получилось сохранить. Попробуй еще раз.'
}

interface PersistentSelfCareQueryOptions<TData> {
  cacheParameters?: readonly string[] | undefined
  enabled?: boolean | undefined
  queryKey: (workspaceId: SelfCareQueryOwnerId) => readonly unknown[]
  request: (api: SelfCareApiClient, signal: AbortSignal) => Promise<TData>
  scope: SelfCareQueryScope
  staleTime: number
}

interface PersistentSelfCareReadState<TData> {
  cacheIdentity: string
  isLoading: boolean
  read: SelfCareCachedRead<TData> | null
}

interface PersistentSelfCareSyncState {
  cacheIdentity: string
  lastSuccessfulSyncAt: string
}

function usePersistentSelfCareQuery<TData>(
  options: PersistentSelfCareQueryOptions<TData>,
) {
  const { actorUserId, api, isEnabled, storageWorkspaceId, workspaceId } =
    useSelfCareApi(
      options.enabled === undefined ? {} : { enabled: options.enabled },
    )
  const cacheKey = createSelfCareCacheKey(
    options.scope,
    options.cacheParameters,
  )
  const cacheIdentity = `${workspaceId}:${cacheKey}`
  const [persistentReadState, setPersistentReadState] =
    useState<PersistentSelfCareReadState<TData> | null>(null)
  const [successfulSyncState, setSuccessfulSyncState] =
    useState<PersistentSelfCareSyncState | null>(null)
  const currentPersistentReadState =
    persistentReadState?.cacheIdentity === cacheIdentity
      ? persistentReadState
      : null

  useEffect(() => {
    if (options.enabled === false || storageWorkspaceId === 'pending') {
      return
    }

    let isActive = true
    const cacheParameters = readSelfCareCacheParameters(options.scope, cacheKey)
    void loadProjectedCachedSelfCareRead<TData>(
      storageWorkspaceId,
      actorUserId,
      cacheKey,
      (data, overlay) =>
        projectSelfCareRead(
          options.scope,
          cacheParameters,
          data,
          overlay,
        ) as TData,
    )
      .then((read) => {
        if (!isActive) {
          return
        }

        setPersistentReadState({ cacheIdentity, isLoading: false, read })
      })
      .catch((error) => {
        reportSelfCareOfflineStorageFailure(error)
        console.warn('Failed to load cached self-care read model.', error)
        if (isActive) {
          setPersistentReadState({
            cacheIdentity,
            isLoading: false,
            read: null,
          })
        }
      })

    return () => {
      isActive = false
    }
  }, [
    actorUserId,
    cacheIdentity,
    cacheKey,
    options.enabled,
    options.scope,
    storageWorkspaceId,
  ])
  const serverQuery = useQuery({
    enabled: isEnabled,
    queryFn: async ({ signal }) => {
      const requestStartedAt = Date.now()
      const writeGeneration =
        getSelfCareOfflineWorkspaceWriteGeneration(storageWorkspaceId)
      const data = await options.request(requireSelfCareApi(api), signal)
      const lastSuccessfulSyncAt = new Date().toISOString()

      try {
        const cachedRead = await saveCachedSelfCareRead(
          storageWorkspaceId,
          actorUserId,
          options.scope,
          cacheKey,
          data,
          lastSuccessfulSyncAt,
          writeGeneration,
          requestStartedAt,
        )
        setSuccessfulSyncState({
          cacheIdentity,
          lastSuccessfulSyncAt: cachedRead.lastSuccessfulSyncAt,
        })
        const projected = await loadProjectedCachedSelfCareRead<TData>(
          storageWorkspaceId,
          actorUserId,
          cacheKey,
          (base, overlay) =>
            projectSelfCareRead(
              options.scope,
              options.cacheParameters ?? [],
              base,
              overlay,
            ) as TData,
        )
        return projected?.data ?? cachedRead.data
      } catch (error) {
        reportSelfCareOfflineStorageFailure(error)
        console.warn('Failed to persist self-care read model.', error)
        setSuccessfulSyncState({ cacheIdentity, lastSuccessfulSyncAt })
        return data
      }
    },
    queryKey: options.queryKey(workspaceId),
    staleTime: options.staleTime,
  })
  const cachedRead = currentPersistentReadState?.read ?? null
  const data = serverQuery.data ?? cachedRead?.data
  const hasData = data !== undefined
  const isCacheLoading =
    options.enabled === false
      ? false
      : (currentPersistentReadState?.isLoading ?? true)
  const lastSuccessfulSyncAt =
    (successfulSyncState?.cacheIdentity === cacheIdentity
      ? successfulSyncState.lastSuccessfulSyncAt
      : null) ??
    cachedRead?.lastSuccessfulSyncAt ??
    null

  return {
    ...serverQuery,
    data,
    isCacheLoading: !hasData && isCacheLoading,
    isError: !hasData && serverQuery.isError,
    isLoading: !hasData && (serverQuery.isLoading || isCacheLoading),
    isPending: !hasData && (serverQuery.isPending || isCacheLoading),
    isShowingCachedData:
      serverQuery.data === undefined &&
      cachedRead !== null &&
      cachedRead !== undefined,
    isSuccess: hasData,
    lastSuccessfulSyncAt,
    status: hasData ? ('success' as const) : serverQuery.status,
  }
}

function useSelfCareApi(options: { enabled?: boolean } = {}) {
  const clientTimeZone = usePlannerTimeZone()
  const { apiConfig, isApiEnabled, readiness, session, workspaceId } =
    useSessionFeatureReadiness({ enabled: options.enabled })
  const api = useMemo(
    () => (apiConfig ? createSelfCareApiClient(apiConfig) : null),
    [apiConfig],
  )

  const actorUserId = session?.actorUserId ?? 'pending'
  const canQueueOfflineWrites = canSessionQueueSelfCare(session)
  const writeReadiness = useMemo(
    () => ({ canWriteProtectedData: readiness.canWriteProtectedData }),
    [readiness.canWriteProtectedData],
  )

  return useMemo(
    () => ({
      actorUserId,
      api,
      canQueueOfflineWrites,
      clientTimeZone,
      isEnabled: isApiEnabled && api !== null,
      readiness: writeReadiness,
      storageWorkspaceId: workspaceId,
      workspaceId: createSelfCareQueryOwnerId(workspaceId, actorUserId),
    }),
    [
      actorUserId,
      api,
      canQueueOfflineWrites,
      clientTimeZone,
      isApiEnabled,
      workspaceId,
      writeReadiness,
    ],
  )
}

export function canSessionQueueSelfCare(
  session: SessionResponse | undefined,
): boolean {
  return Boolean(
    session &&
    session.workspace.kind === 'personal' &&
    session.workspace.id === session.workspaceId &&
    session.role !== 'guest' &&
    session.actorUserId === session.actor.id,
  )
}

class SelfCareOfflineConflictError extends Error {
  constructor() {
    super(
      'Данные изменились в другом месте. Обновите их и повторите изменение.',
    )
    this.name = 'SelfCareOfflineConflictError'
  }
}

type SelfCareApiContext = ReturnType<typeof useSelfCareApi>

interface SelfCareCommandMutationOptions<TData, TVariables> {
  afterResult?:
    | ((
        result: TData,
        context: {
          queryClient: QueryClient
          storageWorkspaceId: string
        },
      ) => Promise<void> | void)
    | undefined
  buildCommand: (
    variables: TVariables,
    source: SelfCareOptimisticSource,
    occurredAt: string,
  ) => unknown
  getInvalidationOptions?:
    ((variables: TVariables) => SelfCareInvalidationOptions) | undefined
  getScopes?:
    ((variables: TVariables) => readonly SelfCareQueryScope[]) | undefined
  invalidationOptions?: SelfCareInvalidationOptions | undefined
  scopes?: readonly SelfCareQueryScope[] | undefined
  selectResult: (result: SelfCareOfflineCommandResult) => TData
}

function useSelfCareCommandMutation<TData, TVariables>(
  options: SelfCareCommandMutationOptions<TData, TVariables>,
) {
  const queryClient = useQueryClient()
  const context = useSelfCareApi()

  return useMutation<TData, Error, TVariables>({
    mutationFn: async (variables) => {
      const occurredAt = new Date().toISOString()
      const source = readSelfCareOptimisticSource(queryClient, context)
      const command = selfCareOfflineCommandSchema.parse(
        options.buildCommand(variables, source, occurredAt),
      )
      const result = await executeSelfCareCommand({
        command,
        context,
        occurredAt,
        queryClient,
        source,
      })
      const scopes = options.getScopes?.(variables) ?? options.scopes ?? []
      const invalidationOptions =
        options.getInvalidationOptions?.(variables) ??
        options.invalidationOptions ??
        SELF_CARE_STALE_ONLY_INVALIDATION

      queueSelfCareInvalidationUnlessSkipped(
        queryClient,
        context.workspaceId,
        scopes,
        invalidationOptions,
      )
      const selected = options.selectResult(result)
      await options.afterResult?.(selected, {
        queryClient,
        storageWorkspaceId: context.storageWorkspaceId,
      })
      return selected
    },
  })
}

async function executeSelfCareCommand(input: {
  command: SelfCareOfflineCommand
  context: SelfCareApiContext
  occurredAt: string
  queryClient: QueryClient
  source: SelfCareOptimisticSource
}): Promise<SelfCareOfflineCommandResult> {
  const { command, context, occurredAt, queryClient, source } = input
  const expectedWriteGeneration = getSelfCareOfflineWorkspaceWriteGeneration(
    context.storageWorkspaceId,
  )

  if (!context.canQueueOfflineWrites) {
    throw new SelfCareApiUnavailableError()
  }

  const optimisticResult = createOptimisticSelfCareResult(command, source)

  if (getSelfCareOfflineStorageHealth() === 'unknown') {
    await probeSelfCareOfflineStorage()
  }

  if (!isSelfCareOfflineStorageAvailable()) {
    return executeSelfCareCommandDirectly(queryClient, context, command)
  }

  let queued: SelfCareOfflineMutationRecord

  try {
    const existing = await listSelfCareOfflineMutations(
      context.storageWorkspaceId,
      context.actorUserId,
      expectedWriteGeneration,
    )

    if (existing.length === 0) {
      await persistCurrentSelfCareQueryBases(
        queryClient,
        context,
        expectedWriteGeneration,
      )
    }

    const entityKeys = new Set([
      ...getSelfCareCommandEntityKeys(command),
      ...getSelfCareResultEntityKeys(optimisticResult),
    ])
    const dependsOn = getSelfCareMutationDependencies(existing, entityKeys)
    const operationId = generateUuidV7()
    const record = await enqueueSelfCareOfflineMutation({
      actorUserId: context.actorUserId,
      clientTimeZone: context.clientTimeZone,
      command,
      dependsOn,
      expectedWriteGeneration,
      occurredAt,
      operationId,
      optimisticResult,
      workspaceId: context.storageWorkspaceId,
    })

    if (!record) {
      if (
        !isSelfCareOfflineWorkspaceWriteGenerationCurrent(
          context.storageWorkspaceId,
          expectedWriteGeneration,
        )
      ) {
        throw new SelfCareApiUnavailableError()
      }

      if (!isSelfCareOfflineStorageAvailable()) {
        return executeSelfCareCommandDirectly(queryClient, context, command)
      }

      throw new SelfCareApiUnavailableError()
    }

    queued = record
  } catch (error) {
    if (reportSelfCareOfflineStorageFailure(error)) {
      return executeSelfCareCommandDirectly(queryClient, context, command)
    }

    throw error
  }

  applySelfCareOverlayToQueries(queryClient, context.workspaceId, {
    command,
    operationId: queued.operationId,
    result: optimisticResult,
    sequence: queued.sequence,
    status: 'pending',
  })

  let serverResult: SelfCareOfflineCommandResult | null = null

  if (
    context.api &&
    context.readiness.canWriteProtectedData &&
    (typeof navigator === 'undefined' || navigator.onLine !== false)
  ) {
    await drainSelfCareOfflineQueue({
      actorUserId: context.actorUserId,
      api: context.api,
      onApplied: async ({ mutation, response }) => {
        await reconcileAcknowledgedSelfCareMutation(
          mutation,
          response.result,
          context,
        )

        if (mutation.id === queued.id) {
          serverResult = response.result
        }
      },
      workspaceId: context.storageWorkspaceId,
    })
    await hydrateSelfCareQueriesFromCache(queryClient, context)

    const remaining = await listSelfCareOfflineMutations(
      context.storageWorkspaceId,
      context.actorUserId,
    )
    const current = remaining.find((mutation) => mutation.id === queued.id)

    if (current?.status === 'conflicted') {
      throw new SelfCareOfflineConflictError()
    }
  }

  return serverResult ?? optimisticResult
}

async function executeSelfCareCommandDirectly(
  queryClient: QueryClient,
  context: SelfCareApiContext,
  command: SelfCareOfflineCommand,
): Promise<SelfCareOfflineCommandResult> {
  if (
    !context.api ||
    !context.readiness.canWriteProtectedData ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  ) {
    throw new SelfCareApiUnavailableError()
  }

  const response = await context.api.executeOfflineCommand({
    clientTimeZone: context.clientTimeZone,
    command,
    operationId: generateUuidV7(),
  })
  applySelfCareOverlayToQueries(queryClient, context.workspaceId, {
    command,
    operationId: response.operationId,
    result: response.result,
    sequence: Number.MAX_SAFE_INTEGER,
    status: 'awaiting_refresh',
  })
  return response.result
}

function getMutationEntityKeys(
  mutation: SelfCareOfflineMutationRecord,
): string[] {
  return [
    ...getSelfCareCommandEntityKeys(mutation.command),
    ...getSelfCareResultEntityKeys(mutation.optimisticResult),
  ]
}

function getSelfCareMutationDependencies(
  existing: readonly SelfCareOfflineMutationRecord[],
  entityKeys: ReadonlySet<string>,
): string[] {
  const latestByEntity = new Map<string, SelfCareOfflineMutationRecord>()

  for (const mutation of existing) {
    for (const key of getMutationEntityKeys(mutation)) {
      if (entityKeys.has(key)) {
        latestByEntity.set(key, mutation)
      }
    }
  }

  return [...new Set([...latestByEntity.values()].map((value) => value.id))]
}

interface SelfCareScopeValue {
  cacheKey: string
  data: unknown
  parameters: string[]
  scope: string
}

function readSelfCareOptimisticSource(
  queryClient: QueryClient,
  context: SelfCareApiContext,
): SelfCareOptimisticSource {
  return buildSelfCareOptimisticSource(
    readSelfCareScopeValues(queryClient, context.workspaceId),
    context.actorUserId,
    context.storageWorkspaceId,
    new Date().toISOString(),
  )
}

function readSelfCareScopeValues(
  queryClient: QueryClient,
  workspaceId: string,
): SelfCareScopeValue[] {
  return queryClient
    .getQueryCache()
    .findAll({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        query.queryKey[0] === 'self-care' &&
        query.queryKey[1] === workspaceId,
    })
    .flatMap((query) => {
      const scope = query.queryKey[2]
      const parameters = query.queryKey.slice(3)

      if (
        typeof scope !== 'string' ||
        query.state.data === undefined ||
        !parameters.every((value): value is string => typeof value === 'string')
      ) {
        return []
      }

      return [
        {
          cacheKey: createSelfCareCacheKey(scope, parameters),
          data: query.state.data,
          parameters,
          scope,
        },
      ]
    })
}

function buildSelfCareOptimisticSource(
  values: readonly SelfCareScopeValue[],
  actorUserId: string,
  workspaceId: string,
  occurredAt: string,
): SelfCareOptimisticSource {
  const dashboards = readScopeData<SelfCareDashboardResponse>(
    values,
    'dashboard',
  )
  const plans = readScopeData<SelfCarePlanResponse>(values, 'plan')
  const histories = readScopeData<SelfCareHistoryResponse>(values, 'history')

  return {
    actorUserId,
    dashboard: mergeSelfCareDashboards(dashboards),
    drafts: readScopeData<SelfCareRitualStepDraftListResponse>(
      values,
      'ritual-step-drafts',
    )[0],
    history: mergeSelfCareHistories(histories),
    list: readScopeData<SelfCareListResponse>(values, 'items')[0],
    occurredAt,
    plan: mergeSelfCarePlans(plans),
    settings: readScopeData<SelfCareSettingsResponse>(values, 'settings')[0],
    templates: readScopeData<SelfCareTemplate[]>(values, 'templates')[0],
    workspaceId,
  }
}

function readScopeData<TData>(
  values: readonly SelfCareScopeValue[],
  scope: string,
): TData[] {
  return values
    .filter((value) => value.scope === scope)
    .map((value) => value.data as TData)
}

function mergeSelfCareDashboards(
  values: readonly SelfCareDashboardResponse[],
): SelfCareDashboardResponse | undefined {
  const first = values[0]

  return first
    ? {
        ...first,
        flexibleGoals: uniqueSelfCareEntries(
          values.flatMap((value) => value.flexibleGoals),
        ),
        overdueItems: uniqueSelfCareEntries(
          values.flatMap((value) => value.overdueItems),
        ),
        planningHints: uniqueSelfCareEntries(
          values.flatMap((value) => value.planningHints),
        ),
        todayItems: uniqueSelfCareEntries(
          values.flatMap((value) => value.todayItems),
        ),
        upcomingImportant: uniqueSelfCareEntries(
          values.flatMap((value) => value.upcomingImportant),
        ),
      }
    : undefined
}

function mergeSelfCarePlans(
  values: readonly SelfCarePlanResponse[],
): SelfCarePlanResponse | undefined {
  const first = values[0]

  return first
    ? {
        ...first,
        courses: uniqueSelfCareEntries(
          values.flatMap((value) => value.courses),
        ),
        medical: uniqueSelfCareEntries(
          values.flatMap((value) => value.medical),
        ),
        occurrences: uniqueSelfCareEntries(
          values.flatMap((value) => value.occurrences),
        ),
        planningHints: uniqueSelfCareEntries(
          values.flatMap((value) => value.planningHints),
        ),
      }
    : undefined
}

function mergeSelfCareHistories(
  values: readonly SelfCareHistoryResponse[],
): SelfCareHistoryResponse | undefined {
  const first = values[0]

  return first
    ? {
        ...first,
        completions: uniqueById(values.flatMap((value) => value.completions)),
        items: uniqueById(values.flatMap((value) => value.items)),
      }
    : undefined
}

function uniqueSelfCareEntries(
  values: SelfCareTodayItem[],
): SelfCareTodayItem[] {
  const byKey = new Map<string, SelfCareTodayItem>()

  for (const value of values) {
    byKey.set(value.occurrence?.id ?? `item:${value.item.id}`, value)
  }

  return [...byKey.values()]
}

function uniqueById<T extends { id: string }>(values: T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()]
}

async function persistCurrentSelfCareQueryBases(
  queryClient: QueryClient,
  context: SelfCareApiContext,
  expectedWriteGeneration: number,
): Promise<void> {
  const values = readSelfCareScopeValues(queryClient, context.workspaceId)

  if (!values.length) {
    throw new SelfCareOfflineBaseUnavailableError()
  }

  await Promise.all(
    values.map(async (value) => {
      const current = await loadCachedSelfCareRead(
        context.storageWorkspaceId,
        context.actorUserId,
        value.cacheKey,
      )

      if (!current) {
        await saveCachedSelfCareRead(
          context.storageWorkspaceId,
          context.actorUserId,
          value.scope,
          value.cacheKey,
          value.data,
          new Date().toISOString(),
          expectedWriteGeneration,
        )
      }
    }),
  )
}

function applySelfCareOverlayToQueries(
  queryClient: QueryClient,
  workspaceId: string,
  overlay: SelfCareOfflineOverlay,
): void {
  for (const value of readSelfCareScopeValues(queryClient, workspaceId)) {
    const queryKey = [
      'self-care',
      workspaceId,
      value.scope,
      ...value.parameters,
    ] as const
    queryClient.setQueryData(queryKey, (current: unknown) =>
      current === undefined
        ? current
        : projectSelfCareRead(value.scope, value.parameters, current, overlay),
    )
  }
}

async function hydrateSelfCareQueriesFromCache(
  queryClient: QueryClient,
  context: Pick<
    SelfCareApiContext,
    'actorUserId' | 'storageWorkspaceId' | 'workspaceId'
  >,
): Promise<void> {
  const values = readSelfCareScopeValues(queryClient, context.workspaceId)
  await Promise.all(
    values.map(async (value) => {
      const read = await loadProjectedCachedSelfCareRead(
        context.storageWorkspaceId,
        context.actorUserId,
        value.cacheKey,
        (data, overlay) =>
          projectSelfCareRead(value.scope, value.parameters, data, overlay),
      )

      if (read) {
        queryClient.setQueryData(
          ['self-care', context.workspaceId, value.scope, ...value.parameters],
          read.data,
        )
      }
    }),
  )
}

async function reconcileAcknowledgedSelfCareMutation(
  mutation: SelfCareOfflineMutationRecord,
  authoritativeResult: SelfCareOfflineCommandResult,
  context: SelfCareApiContext,
): Promise<void> {
  const committed = await commitSelfCareOfflineMutationResult(
    mutation.id,
    context.storageWorkspaceId,
    context.actorUserId,
    projectSelfCareCachedRead,
    { retainMutation: true },
  )

  if (!committed) {
    throw new Error('Self-care result reconciliation is incomplete.')
  }

  await rebaseSelfCareDependentsAfterAcknowledgement(
    mutation,
    authoritativeResult,
    context,
  )
  await completeSelfCareOfflineMutation(
    mutation.id,
    context.storageWorkspaceId,
    context.actorUserId,
  )
}

async function rebaseSelfCareDependentsAfterAcknowledgement(
  acknowledged: SelfCareOfflineMutationRecord,
  authoritativeResult: SelfCareOfflineCommandResult,
  context: SelfCareApiContext,
): Promise<void> {
  const mutations = await listSelfCareOfflineMutations(
    context.storageWorkspaceId,
    context.actorUserId,
  )
  const dependentIds = collectSelfCareDependentIds(mutations, acknowledged.id)

  if (!dependentIds.size) {
    return
  }

  const snapshots = await loadConfirmedSelfCareCachedScopes(
    context.storageWorkspaceId,
    context.actorUserId,
  )
  let virtualValues: SelfCareScopeValue[] = snapshots.map((snapshot) => ({
    ...snapshot,
    parameters: readSelfCareCacheParameters(snapshot.scope, snapshot.cacheKey),
  }))
  const completionIdAliases = getCompletionIdAliases(
    acknowledged.optimisticResult,
    authoritativeResult,
  )
  const rebases = []

  for (const mutation of mutations) {
    if (mutation.status === 'conflicted') {
      continue
    }

    if (dependentIds.has(mutation.id)) {
      const source = buildSelfCareOptimisticSource(
        virtualValues,
        context.actorUserId,
        context.storageWorkspaceId,
        mutation.occurredAt,
      )
      const command = rebaseSelfCareCommand(
        mutation.command,
        source,
        completionIdAliases,
      )
      const optimisticResult = createOptimisticSelfCareResult(command, source)
      rebases.push({
        command,
        mutationId: mutation.id,
        optimisticResult,
      })
      virtualValues = projectSelfCareScopeValues(virtualValues, {
        command,
        operationId: mutation.operationId,
        result: optimisticResult,
        sequence: mutation.sequence,
        status: 'pending',
      })
      continue
    }

    if (mutation.status !== 'awaiting_refresh') {
      virtualValues = projectSelfCareScopeValues(virtualValues, {
        command: mutation.command,
        operationId: mutation.operationId,
        result: mutation.serverResult ?? mutation.optimisticResult,
        sequence: mutation.sequence,
        status: mutation.status,
      })
    }
  }

  await rebaseSelfCareOfflineMutations(
    context.storageWorkspaceId,
    context.actorUserId,
    rebases,
  )
}

async function rebaseConflictedSelfCareMutations(
  context: SelfCareApiContext,
): Promise<void> {
  const mutations = await listSelfCareOfflineMutations(
    context.storageWorkspaceId,
    context.actorUserId,
  )
  const conflictRoots = mutations.filter(
    (mutation) => mutation.status === 'conflicted',
  )

  if (!conflictRoots.length) {
    return
  }

  const rebaseIds = new Set<string>()
  for (const root of conflictRoots) {
    rebaseIds.add(root.id)
    for (const dependentId of collectSelfCareDependentIds(mutations, root.id)) {
      rebaseIds.add(dependentId)
    }
  }

  const snapshots = await loadConfirmedSelfCareCachedScopes(
    context.storageWorkspaceId,
    context.actorUserId,
  )
  let virtualValues: SelfCareScopeValue[] = snapshots.map((snapshot) => ({
    ...snapshot,
    parameters: readSelfCareCacheParameters(snapshot.scope, snapshot.cacheKey),
  }))
  const rebases = []

  for (const mutation of mutations) {
    if (rebaseIds.has(mutation.id)) {
      const source = buildSelfCareOptimisticSource(
        virtualValues,
        context.actorUserId,
        context.storageWorkspaceId,
        mutation.occurredAt,
      )
      const command = rebaseSelfCareCommand(mutation.command, source, new Map())
      const optimisticResult = createOptimisticSelfCareResult(command, source)
      rebases.push({
        command,
        mutationId: mutation.id,
        ...(mutation.status === 'conflicted'
          ? { operationId: generateUuidV7() }
          : {}),
        optimisticResult,
      })
      virtualValues = projectSelfCareScopeValues(virtualValues, {
        command,
        operationId: mutation.operationId,
        result: optimisticResult,
        sequence: mutation.sequence,
        status: 'pending',
      })
      continue
    }

    if (mutation.status !== 'conflicted') {
      virtualValues = projectSelfCareScopeValues(virtualValues, {
        command: mutation.command,
        operationId: mutation.operationId,
        result: mutation.serverResult ?? mutation.optimisticResult,
        sequence: mutation.sequence,
        status: mutation.status,
      })
    }
  }

  await rebaseSelfCareOfflineMutations(
    context.storageWorkspaceId,
    context.actorUserId,
    rebases,
  )
}

function projectSelfCareScopeValues(
  values: readonly SelfCareScopeValue[],
  overlay: SelfCareOfflineOverlay,
): SelfCareScopeValue[] {
  return values.map((value) => ({
    ...value,
    data: projectSelfCareRead(
      value.scope,
      value.parameters,
      value.data,
      overlay,
    ),
  }))
}

function collectSelfCareDependentIds(
  mutations: readonly SelfCareOfflineMutationRecord[],
  rootId: string,
): Set<string> {
  const resolved = new Set([rootId])
  const dependents = new Set<string>()
  let changed = true

  while (changed) {
    changed = false
    for (const mutation of mutations) {
      if (
        !resolved.has(mutation.id) &&
        mutation.dependsOn.some((dependency) => resolved.has(dependency))
      ) {
        resolved.add(mutation.id)
        dependents.add(mutation.id)
        changed = true
      }
    }
  }

  return dependents
}

function getCompletionIdAliases(
  optimistic: SelfCareOfflineCommandResult,
  authoritative: SelfCareOfflineCommandResult,
): ReadonlyMap<string, string> {
  return optimistic.kind === 'completion' &&
    authoritative.kind === 'completion' &&
    optimistic.completion.id !== authoritative.completion.id
    ? new Map([[optimistic.completion.id, authoritative.completion.id]])
    : new Map()
}

function rebaseSelfCareCommand(
  command: SelfCareOfflineCommand,
  source: SelfCareOptimisticSource,
  completionIdAliases: ReadonlyMap<string, string>,
): SelfCareOfflineCommand {
  switch (command.type) {
    case 'create_item':
    case 'create_item_from_template':
      return command
    case 'update_item': {
      const scheduleChange = command.scheduleChange
      return {
        ...command,
        expectedVersion: requireSelfCareItemFromSource(source, command.itemId)
          .version,
        ...(scheduleChange?.type === 'reschedule' ||
        scheduleChange?.type === 'update_schedule'
          ? {
              scheduleChange: {
                ...scheduleChange,
                expectedVersion: requireSelfCareOccurrenceFromSource(
                  source,
                  scheduleChange.occurrenceId,
                ).version,
              },
            }
          : {}),
      }
    }
    case 'archive_item':
    case 'complete_item_now':
    case 'complete_flexible_goal':
    case 'complete_course_session':
      return {
        ...command,
        expectedVersion: requireSelfCareItemFromSource(source, command.itemId)
          .version,
      }
    case 'schedule_item':
      return {
        ...command,
        expectedVersion: requireSelfCareItemFromSource(source, command.itemId)
          .version,
        ...(command.existingOccurrenceId
          ? {
              expectedOccurrenceVersion: requireSelfCareOccurrenceFromSource(
                source,
                command.existingOccurrenceId,
              ).version,
            }
          : {}),
      }
    case 'move_occurrence':
    case 'cancel_occurrence':
    case 'skip_occurrence':
    case 'complete_occurrence':
      return {
        ...command,
        expectedVersion: requireSelfCareOccurrenceFromSource(
          source,
          command.occurrenceId,
        ).version,
      }
    case 'update_completion': {
      const completionId =
        completionIdAliases.get(command.completionId) ?? command.completionId
      return {
        ...command,
        completionId,
        expectedVersion: requireSelfCareCompletionFromSource(
          source,
          completionId,
        ).version,
      }
    }
    case 'update_settings': {
      const settings = source.settings?.settings ?? source.dashboard?.settings

      if (!settings) {
        throw new SelfCareOfflineBaseUnavailableError()
      }

      return { ...command, expectedVersion: settings.version }
    }
    case 'upsert_ritual_step_draft':
      return {
        ...command,
        expectedVersion:
          source.drafts?.drafts.find(
            (draft) =>
              draft.date === command.input.date &&
              draft.itemId === command.input.itemId &&
              draft.occurrenceId === command.input.occurrenceId,
          )?.version ?? null,
      }
  }
}

function readSelfCareCacheParameters(
  scope: string,
  cacheKey: string,
): string[] {
  const prefix = `${scope}:`
  return cacheKey.startsWith(prefix)
    ? cacheKey
        .slice(prefix.length)
        .split(':')
        .filter(Boolean)
        .map((value) => decodeURIComponent(value))
    : []
}

function requireSelfCareItemFromSource(
  source: SelfCareOptimisticSource,
  itemId: string,
): SelfCareItem {
  const item = findSelfCareItem(source, itemId)

  if (!item) {
    throw new SelfCareOfflineBaseUnavailableError()
  }

  return item
}

function requireSelfCareOccurrenceFromSource(
  source: SelfCareOptimisticSource,
  occurrenceId: string,
): SelfCareOccurrence {
  const occurrence = findSelfCareOccurrence(source, occurrenceId)

  if (!occurrence) {
    throw new SelfCareOfflineBaseUnavailableError()
  }

  return occurrence
}

function requireSelfCareCompletionFromSource(
  source: SelfCareOptimisticSource,
  completionId: string,
): SelfCareCompletion {
  const completion = findSelfCareCompletion(source, completionId)

  if (!completion) {
    throw new SelfCareOfflineBaseUnavailableError()
  }

  return completion
}

function withCommandCompletionTime<
  TInput extends { completedAt?: string | undefined },
>(
  input: TInput | undefined,
  occurredAt: string,
): TInput & { completedAt: string } {
  return {
    ...(input ?? ({} as TInput)),
    completedAt: input?.completedAt ?? occurredAt,
  }
}

function createReplacementScheduleInput(
  occurrence: SelfCareOccurrence,
  scheduledFor: string,
): SelfCareItemScheduleInput {
  return {
    currency: null,
    note: '',
    place: null,
    price: null,
    reminderOffsetsMinutes: occurrence.reminderOffsetsMinutes,
    scheduledFor,
    scheduledTime: null,
    specialistContact: null,
    specialistName: null,
    timezone: occurrence.reminderTimeZone,
  }
}

function normalizeSelfCareItemRelationIds<
  TInput extends {
    alternatives?: SelfCareItemInput['alternatives'] | undefined
    scheduleRule?: SelfCareItemInput['scheduleRule'] | undefined
    steps?: SelfCareItemInput['steps'] | undefined
  },
>(
  input: TInput,
  list: SelfCareListResponse | undefined,
  itemId: string,
): TInput {
  const existingSteps = (list?.steps ?? [])
    .filter((step) => step.itemId === itemId)
    .sort((left, right) => left.order - right.order)
  const usedStepIds = new Set<string>()
  const steps = input.steps?.map((step, index) => {
    const existing =
      (step.id
        ? existingSteps.find((candidate) => candidate.id === step.id)
        : (existingSteps.find(
            (candidate) =>
              candidate.title === step.title && !usedStepIds.has(candidate.id),
          ) ?? existingSteps[index])) ?? null
    const id = step.id ?? existing?.id ?? generateUuidV7()
    usedStepIds.add(id)
    return { ...step, id }
  })
  const existingAlternatives = (list?.alternatives ?? []).filter(
    (alternative) => alternative.itemId === itemId,
  )
  const usedAlternativeIds = new Set<string>()
  const alternatives = input.alternatives?.map((alternative, index) => {
    const existing =
      (alternative.id
        ? existingAlternatives.find(
            (candidate) => candidate.id === alternative.id,
          )
        : (existingAlternatives.find(
            (candidate) =>
              candidate.title === alternative.title &&
              !usedAlternativeIds.has(candidate.id),
          ) ?? existingAlternatives[index])) ?? null
    const id = alternative.id ?? existing?.id ?? generateUuidV7()
    usedAlternativeIds.add(id)
    return { ...alternative, id }
  })
  const existingScheduleRule = list?.scheduleRules.find(
    (rule) => rule.itemId === itemId,
  )

  return {
    ...input,
    ...(alternatives ? { alternatives } : {}),
    ...(input.scheduleRule
      ? {
          scheduleRule: {
            ...input.scheduleRule,
            id:
              input.scheduleRule.id ??
              existingScheduleRule?.id ??
              generateUuidV7(),
          },
        }
      : {}),
    ...(steps ? { steps } : {}),
  }
}

function selectItemResult(result: SelfCareOfflineCommandResult): SelfCareItem {
  if (result.kind !== 'item') {
    throw new Error('Self-care command returned an unexpected result.')
  }

  return result.item
}

function selectOccurrenceResult(
  result: SelfCareOfflineCommandResult,
): SelfCareOccurrence {
  if (
    result.kind !== 'occurrence' &&
    result.kind !== 'occurrence_rescheduled'
  ) {
    throw new Error('Self-care command returned an unexpected result.')
  }

  return result.occurrence
}

function selectCompletionResult(
  result: SelfCareOfflineCommandResult,
): SelfCareCompletion {
  if (result.kind !== 'completion') {
    throw new Error('Self-care command returned an unexpected result.')
  }

  return result.completion
}

function selectSettingsResult(
  result: SelfCareOfflineCommandResult,
): SelfCareSettingsResponse {
  if (result.kind !== 'settings') {
    throw new Error('Self-care command returned an unexpected result.')
  }

  return result.value
}

function selectRitualStepDraftsResult(
  result: SelfCareOfflineCommandResult,
): SelfCareRitualStepDraftListResponse {
  if (result.kind !== 'ritual_step_drafts') {
    throw new Error('Self-care command returned an unexpected result.')
  }

  return result.value
}

function requireSelfCareApi(api: SelfCareApiClient | null): SelfCareApiClient {
  if (!api) {
    throw new SelfCareApiUnavailableError()
  }

  return api
}

function isSelfCareNetworkError(error: unknown): boolean {
  return isBrowserRetryableOfflineError(error)
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
