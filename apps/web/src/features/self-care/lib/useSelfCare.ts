import {
  buildSelfCareItemInputFromTemplate,
  generateUuidV7,
  type SelfCareAnalyticsResponse,
  type SelfCareCompletionInput,
  type SelfCareDashboardResponse,
  type SelfCareHistoryResponse,
  type SelfCareItemInput,
  type SelfCareListResponse,
  type SelfCareOccurrenceMoveInput,
  type SelfCareOccurrenceSkipInput,
  selfCareOfflineCommandSchema,
  type SelfCarePlanResponse,
  type SelfCareRitualCompletionInput,
  type SelfCareRitualStepDraftInput,
  type SelfCareRitualStepDraftListResponse,
  type SelfCareSettingsResponse,
  type SelfCareSettingsUpdateInput,
  type SelfCareTemplate,
} from '@planner/contracts'
import {
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
import { useOfflineQueueDrain } from '@/shared/lib/offline-sync'
import { addDateDays, getTodayDate } from '@/shared/time/time.service'

import {
  cancelSelfCareOfflineMutation,
  countSelfCareOfflineMutations,
  createSelfCareCacheKey,
  getSelfCareOfflineStorageHealth,
  getSelfCareOfflineWorkspaceWriteGeneration,
  isSelfCareOccurrenceClosedConflict,
  isSelfCareOfflineStorageAvailable,
  listSelfCareOfflineMutations,
  loadProjectedCachedSelfCareRead,
  probeSelfCareOfflineStorage,
  reportSelfCareOfflineStorageFailure,
  saveCachedSelfCareRead,
  type SelfCareOfflineMutationRecord,
  subscribeSelfCareOfflineQueue,
} from './offline-self-care-store'
import { createSelfCareApiClient } from './self-care-api'
import {
  SelfCareOfflineBaseUnavailableError,
  type SelfCareOptimisticSource,
} from './self-care-offline-command'
import { projectSelfCareRead } from './self-care-offline-projection'
import { drainSelfCareOfflineQueue } from './self-care-offline-sync'
import type {
  CompletionUpdateVariables,
  CreateFromTemplateVariables,
  CreateItemVariables,
  ItemCompletionVariables,
  ItemScheduleVariables,
  ItemUpdateVariables,
  OccurrenceMutationVariables,
  PersistentSelfCareQueryOptions,
  PersistentSelfCareReadState,
  PersistentSelfCareSyncState,
  RequiredOccurrenceMutationVariables,
  SelfCareCommandMutationOptions,
} from './self-care-query-runtime'
import {
  canSessionQueueSelfCare,
  createReplacementScheduleInput,
  createSelfCareQueryOwnerId,
  EMPTY_SELF_CARE_OFFLINE_QUEUE_COUNTS,
  executeSelfCareCommand,
  hydrateSelfCareOptimisticSourceFromConfirmedCache,
  hydrateSelfCareQueriesFromCache,
  invalidateMigratedHabitRoutine,
  normalizeCreateItemVariables,
  normalizeSelfCareItemRelationIds,
  queueSelfCareInvalidationUnlessSkipped,
  readSelfCareCacheParameters,
  readSelfCareOptimisticSource,
  readSelfCareScopeValues,
  rebaseConflictedSelfCareMutations,
  reconcileAcknowledgedSelfCareMutation,
  requireSelfCareApi,
  requireSelfCareCompletionFromSource,
  requireSelfCareItemFromSource,
  requireSelfCareOccurrenceFromSource,
  runSelfCareCommandOnce,
  runSelfCareCommandSerially,
  selectCompletionResult,
  selectItemResult,
  selectOccurrenceResult,
  selectRitualStepDraftsResult,
  selectSettingsResult,
  SELF_CARE_COMPLETION_CHANGE_SCOPES,
  SELF_CARE_ITEM_CHANGE_SCOPES,
  SELF_CARE_OCCURRENCE_CHANGE_SCOPES,
  SELF_CARE_SETTINGS_CHANGE_SCOPES,
  SELF_CARE_STALE_ONLY_INVALIDATION,
  selfCareAnalyticsQueryKey,
  selfCareDashboardQueryKey,
  selfCareHistoryQueryKey,
  selfCareItemsQueryKey,
  selfCarePlanQueryKey,
  selfCareRitualStepDraftsQueryKey,
  selfCareSettingsQueryKey,
  selfCareTemplatesQueryKey,
  serializeSelfCareCommandKey,
  withCommandCompletionTime,
} from './self-care-query-runtime'
export {
  canSessionQueueSelfCare,
  createSelfCareQueryOwnerId,
  getSelfCareErrorMessage,
  isSelfCareApiUnavailableError,
  SELF_CARE_API_UNAVAILABLE_MESSAGE,
  SELF_CARE_NETWORK_ERROR_MESSAGE,
  selfCareAnalyticsQueryKey,
  SelfCareApiUnavailableError,
  selfCareDashboardQueryKey,
  selfCareHistoryQueryKey,
  selfCareItemsQueryKey,
  selfCarePlanQueryKey,
  type SelfCareQueryOwnerId,
  selfCareRitualStepDraftsQueryKey,
  selfCareSettingsQueryKey,
  selfCareTemplatesQueryKey,
} from './self-care-query-runtime'
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
  const discardConflictsMatching = useCallback(
    async (matches: (mutation: SelfCareOfflineMutationRecord) => boolean) => {
      const mutations = await listSelfCareOfflineMutations(
        context.storageWorkspaceId,
        context.actorUserId,
      )
      await Promise.all(
        mutations
          .filter(
            (mutation) => mutation.status === 'conflicted' && matches(mutation),
          )
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
    },
    [context, queryClient, refreshCounts],
  )
  const discardConflicts = useCallback(
    () => discardConflictsMatching(() => true),
    [discardConflictsMatching],
  )
  const discardClosedOccurrenceConflicts = useCallback(
    () => discardConflictsMatching(isSelfCareOccurrenceClosedConflict),
    [discardConflictsMatching],
  )
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
    discardClosedOccurrenceConflicts,
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
    getPendingKey: (variables) =>
      `create_item:${serializeSelfCareCommandKey(normalizeCreateItemVariables(variables))}`,
    scopes: SELF_CARE_ITEM_CHANGE_SCOPES,
    selectResult: selectItemResult,
  })
}

export function useCreateSelfCareItemFromTemplate() {
  const plannerTimeZone = usePlannerTimeZone()

  return useSelfCareCommandMutation({
    buildCommand: (
      { input, scheduleInput, templateId }: CreateFromTemplateVariables,
      source,
    ) => {
      const itemId = generateUuidV7()
      const template = source.templates?.find(
        (candidate) => candidate.id === templateId,
      )
      if (!template) {
        throw new SelfCareOfflineBaseUnavailableError()
      }
      // Persist the resolved defaults so optimistic reads and a later sync use
      // the same schedule, goal, course details and visit date.
      const overrides = buildSelfCareItemInputFromTemplate(
        template,
        input?.overrides,
        { plannerTimeZone },
      )
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
          overrides,
          source.list,
          itemId,
        ),
        templateId,
        type: 'create_item_from_template',
      }
    },
    getPendingKey: ({ templateId }) =>
      `create_item_from_template:${templateId}`,
    scopes: SELF_CARE_ITEM_CHANGE_SCOPES,
    selectResult: selectItemResult,
  })
}

export function useUpdateSelfCareItem() {
  return useSelfCareCommandMutation({
    afterResult: async (item, { queryClient, storageWorkspaceId }) => {
      await invalidateMigratedHabitRoutine(
        queryClient,
        storageWorkspaceId,
        item.migratedFromHabitId,
      )
    },
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
        ...(input.isActive !== undefined ? { actedAt: occurredAt } : {}),
        type: 'update_item',
      }
    },
    getInvalidationOptions: (variables: ItemUpdateVariables) => ({
      skipInvalidation: variables.skipInvalidation,
    }),
    getPendingKey: (variables: ItemUpdateVariables) =>
      `update_item:${variables.itemId}:${serializeSelfCareCommandKey({
        input: variables.input,
        scheduleInput: variables.scheduleInput,
      })}`,
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
    getPendingKey: ({ occurrenceId }) => `complete_occurrence:${occurrenceId}`,
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
    getPendingKey: ({ itemId }) => `complete_item_now:${itemId}`,
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
    getPendingKey: ({ completionId, input }) =>
      `update_completion:${completionId}:${serializeSelfCareCommandKey(input)}`,
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
    getPendingKey: ({ itemId }) => `complete_flexible_goal:${itemId}`,
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
    getPendingKey: ({ itemId }) => `complete_course_session:${itemId}`,
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

export type SelfCareApiContext = ReturnType<typeof useSelfCareApi>

function useSelfCareCommandMutation<TData, TVariables>(
  options: SelfCareCommandMutationOptions<TData, TVariables>,
) {
  const queryClient = useQueryClient()
  const context = useSelfCareApi()

  return useMutation<TData, Error, TVariables>({
    mutationFn: (variables) => {
      const pendingKey = options.getPendingKey?.(variables)
      const scopeKey = `${context.storageWorkspaceId}:${context.actorUserId}`
      const execute = async () => {
        const occurredAt = new Date().toISOString()
        const currentScopeValues = readSelfCareScopeValues(
          queryClient,
          context.workspaceId,
        )
        const shouldHydrateConfirmedCache =
          currentScopeValues.length === 0 ||
          !context.readiness.canWriteProtectedData ||
          (typeof navigator !== 'undefined' && navigator.onLine === false)
        const initialSource = shouldHydrateConfirmedCache
          ? ((await hydrateSelfCareOptimisticSourceFromConfirmedCache(
              queryClient,
              context,
            )) ?? readSelfCareOptimisticSource(queryClient, context))
          : readSelfCareOptimisticSource(queryClient, context)
        const buildAndExecute = async (source: SelfCareOptimisticSource) => {
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

          return result
        }
        let execution: Awaited<ReturnType<typeof buildAndExecute>>

        try {
          execution = await buildAndExecute(initialSource)
        } catch (error) {
          if (!(error instanceof SelfCareOfflineBaseUnavailableError)) {
            throw error
          }

          const restoredSource =
            await hydrateSelfCareOptimisticSourceFromConfirmedCache(
              queryClient,
              context,
            )

          if (!restoredSource) {
            throw error
          }

          execution = await buildAndExecute(restoredSource)
        }

        const result = execution
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
      }

      return pendingKey
        ? runSelfCareCommandOnce(`${scopeKey}:${pendingKey}`, () =>
            runSelfCareCommandSerially(scopeKey, execute),
          )
        : runSelfCareCommandSerially(scopeKey, execute)
    },
  })
}
