import {
  type CleaningListResponse,
  type CleaningSeedInput,
  cleaningSeedInputSchema,
  type CleaningTaskActionInput,
  cleaningTaskActionInputSchema,
  type CleaningTaskActionResponse,
  type CleaningTaskHistoryAction,
  type CleaningTaskRecord,
  type CleaningTaskStateRecord,
  type CleaningTaskUpdateInput,
  cleaningTaskUpdateInputSchema,
  type CleaningTodayResponse,
  type CleaningZoneRecord,
  type CleaningZoneUpdateInput,
  cleaningZoneUpdateInputSchema,
  generateUuidV7,
  type NewCleaningTaskInput,
  newCleaningTaskInputSchema,
  type NewCleaningZoneInput,
  newCleaningZoneInputSchema,
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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  usePlannerTimeZone,
  useSessionFeatureReadiness,
} from '@/features/session'
import {
  createOfflineDrainCoordinator,
  isBrowserRetryableOfflineError,
  useOfflineQueueDrain,
} from '@/shared/lib/offline-sync'
import { getTodayDate } from '@/shared/time/time.service'

import {
  type CleaningApiClient,
  CleaningApiError,
  createCleaningApiClient,
} from './cleaning-api'
import { projectCleaningToday } from './offline-cleaning-projection'
import {
  CleaningOfflineGenerationInvalidatedError,
  type CleaningOfflineMutationInput,
  CleaningOfflineMutationNotPersistedError,
  type CleaningOfflineQueueCounts,
  discardConflictedCleaningMutations,
  enqueueCleaningOfflineMutation,
  getCleaningOfflineQueueCounts,
  getCleaningOfflineStorageHealth,
  getCleaningOfflineWorkspaceWriteGeneration,
  isCleaningOfflineStorageReady,
  isCleaningOfflineWorkspaceWriteGenerationCurrent,
  loadCachedCleaningPlan,
  loadCachedCleaningToday,
  probeCleaningOfflineStorage,
  replaceCachedCleaningPlan,
  replaceCachedCleaningToday,
  retryConflictedCleaningMutations,
  subscribeCleaningOfflineQueue,
} from './offline-cleaning-store'
import {
  type CleaningOfflineDrainResult,
  drainCleaningOfflineQueue,
} from './offline-cleaning-sync'

interface CleaningTaskActionVariables {
  input?: CleaningTaskActionInput | undefined
  taskId: string
}

interface CleaningTaskUpdateVariables {
  input: CleaningTaskUpdateInput
  taskId: string
}

interface CleaningZoneUpdateVariables {
  input: CleaningZoneUpdateInput
  zoneId: string
}

interface CleaningSyncFreshness {
  cacheIdentity: string
  lastSuccessfulSyncAt: string
}

interface CleaningCacheHydration {
  cacheIdentity: string
}

const cleaningDrainCoordinator = createOfflineDrainCoordinator<
  string,
  CleaningOfflineDrainResult
>()
const cleaningInFlightWrites = new Map<string, Promise<unknown>>()
const cleaningWriteTails = new Map<string, Promise<void>>()

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

export function cleaningQueryKey(workspaceId: string, actorUserId: string) {
  return ['cleaning', workspaceId, actorUserId] as const
}

export function cleaningTodayQueryKey(
  workspaceId: string,
  actorUserId: string,
  date: string,
) {
  return ['cleaning', workspaceId, actorUserId, 'today', date] as const
}

export function useCleaningPlan(options: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient()
  const cleaningApi = useCleaningApi(options)
  const { actorUserId, api, isEnabled, workspaceId } = cleaningApi
  const queryKey = useMemo(
    () => cleaningQueryKey(workspaceId, actorUserId),
    [actorUserId, workspaceId],
  )
  const cacheIdentity = `${workspaceId}:${actorUserId}:plan`
  const [syncFreshness, setSyncFreshness] =
    useState<CleaningSyncFreshness | null>(null)
  const [cacheHydration, setCacheHydration] =
    useState<CleaningCacheHydration | null>(null)
  const isCacheHydrating =
    options.enabled !== false &&
    workspaceId !== 'pending' &&
    cacheHydration?.cacheIdentity !== cacheIdentity
  const lastSuccessfulSyncAt = getCleaningFreshness(
    syncFreshness,
    cacheIdentity,
  )

  useEffect(() => {
    if (options.enabled === false || workspaceId === 'pending') {
      return
    }

    let isActive = true

    void loadCachedCleaningPlan(workspaceId, actorUserId)
      .then((cachedRead) => {
        if (!isActive || !cachedRead) {
          return
        }

        setSyncFreshness((current) =>
          mergeCleaningFreshness(
            current,
            cacheIdentity,
            cachedRead.lastSuccessfulSyncAt,
          ),
        )
        queryClient.setQueryData<CleaningListResponse>(
          queryKey,
          (current) => current ?? cachedRead.data,
        )
      })
      .catch((error) => {
        console.warn('Failed to read cached cleaning plan.', error)
      })
      .finally(() => {
        if (isActive) {
          setCacheHydration({ cacheIdentity })
        }
      })

    return () => {
      isActive = false
    }
  }, [
    actorUserId,
    cacheIdentity,
    options.enabled,
    queryClient,
    queryKey,
    workspaceId,
  ])

  const query = useQuery({
    enabled: isEnabled,
    queryFn: async ({ signal }) => {
      const requestStartedAt = Date.now()
      const writeGeneration =
        getCleaningOfflineWorkspaceWriteGeneration(workspaceId)
      const data = await requireCleaningApi(api).listCleaning(signal)
      const lastSuccessfulSyncAt = new Date().toISOString()

      try {
        const cachedRead = await replaceCachedCleaningPlan(
          workspaceId,
          actorUserId,
          data,
          lastSuccessfulSyncAt,
          writeGeneration,
          requestStartedAt,
        )
        setSyncFreshness({
          cacheIdentity,
          lastSuccessfulSyncAt: cachedRead.lastSuccessfulSyncAt,
        })

        return cachedRead.data
      } catch (error) {
        console.warn('Failed to cache the cleaning plan.', error)
        setSyncFreshness({
          cacheIdentity,
          lastSuccessfulSyncAt,
        })
        return data
      }
    },
    queryKey,
    retry: (failureCount, error) =>
      !isCleaningConnectionError(error) && failureCount < 2,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (query.dataUpdatedAt === 0 || workspaceId === 'pending') {
      return
    }

    void loadCachedCleaningPlan(workspaceId, actorUserId)
      .then((cachedRead) => {
        if (cachedRead) {
          setSyncFreshness((current) =>
            mergeCleaningFreshness(
              current,
              cacheIdentity,
              cachedRead.lastSuccessfulSyncAt,
            ),
          )
        }
      })
      .catch((error) => {
        console.warn('Failed to read cleaning sync freshness.', error)
      })
  }, [actorUserId, cacheIdentity, query.dataUpdatedAt, workspaceId])

  const offlineQueue = useCleaningQueueControls({
    actorUserId,
    api,
    canDrain: cleaningApi.readiness.canWriteProtectedData,
    canQueueWrites: cleaningApi.canQueueOfflineWrites,
    queryClient,
    retrySession: cleaningApi.sessionQuery.refetch,
    workspaceId,
  })

  return {
    ...query,
    isCacheHydrating: query.data === undefined && isCacheHydrating,
    lastSuccessfulSyncAt,
    offlineQueue,
    readiness: cleaningApi.getReadiness({
      hasCachedData: query.data !== undefined,
    }),
    retrySession: cleaningApi.sessionQuery.refetch,
    sessionError: cleaningApi.sessionQuery.error,
  }
}

export function useCleaningToday(
  date?: string,
  options: { enabled?: boolean } = {},
) {
  const queryClient = useQueryClient()
  const cleaningApi = useCleaningApi(options)
  const { actorUserId, api, isEnabled, workspaceId } = cleaningApi
  const plannerTimeZone = usePlannerTimeZone()
  const resolvedDate = date ?? getTodayDate(plannerTimeZone)
  const queryKey = useMemo(
    () => cleaningTodayQueryKey(workspaceId, actorUserId, resolvedDate),
    [actorUserId, resolvedDate, workspaceId],
  )
  const cacheIdentity = `${workspaceId}:${actorUserId}:today:${resolvedDate}`
  const [syncFreshness, setSyncFreshness] =
    useState<CleaningSyncFreshness | null>(null)
  const [cacheHydration, setCacheHydration] =
    useState<CleaningCacheHydration | null>(null)
  const isCacheHydrating =
    options.enabled !== false &&
    workspaceId !== 'pending' &&
    cacheHydration?.cacheIdentity !== cacheIdentity
  const lastSuccessfulSyncAt = getCleaningFreshness(
    syncFreshness,
    cacheIdentity,
  )

  useEffect(() => {
    if (options.enabled === false || workspaceId === 'pending') {
      return
    }

    let isActive = true

    void loadCachedCleaningToday(workspaceId, actorUserId, resolvedDate)
      .then((cachedRead) => {
        if (!isActive || !cachedRead) {
          return
        }

        setSyncFreshness((current) =>
          mergeCleaningFreshness(
            current,
            cacheIdentity,
            cachedRead.lastSuccessfulSyncAt,
          ),
        )
        queryClient.setQueryData<CleaningTodayResponse>(
          queryKey,
          (current) => current ?? cachedRead.data,
        )
      })
      .catch((error) => {
        console.warn('Failed to read cached cleaning day.', error)
      })
      .finally(() => {
        if (isActive) {
          setCacheHydration({ cacheIdentity })
        }
      })

    return () => {
      isActive = false
    }
  }, [
    cacheIdentity,
    actorUserId,
    options.enabled,
    queryClient,
    queryKey,
    resolvedDate,
    workspaceId,
  ])

  const query = useQuery({
    enabled: isEnabled,
    queryFn: async ({ signal }) => {
      const requestStartedAt = Date.now()
      const writeGeneration =
        getCleaningOfflineWorkspaceWriteGeneration(workspaceId)
      const data = await requireCleaningApi(api).getToday(resolvedDate, signal)
      const lastSuccessfulSyncAt = new Date().toISOString()

      try {
        const cachedRead = await replaceCachedCleaningToday(
          workspaceId,
          actorUserId,
          resolvedDate,
          data,
          lastSuccessfulSyncAt,
          writeGeneration,
          requestStartedAt,
        )
        setSyncFreshness({
          cacheIdentity,
          lastSuccessfulSyncAt: cachedRead.lastSuccessfulSyncAt,
        })

        return cachedRead.data
      } catch (error) {
        console.warn('Failed to cache the cleaning day.', error)
        setSyncFreshness({
          cacheIdentity,
          lastSuccessfulSyncAt,
        })
        return data
      }
    },
    queryKey,
    retry: (failureCount, error) =>
      !isCleaningConnectionError(error) && failureCount < 2,
    staleTime: 20_000,
  })

  useEffect(() => {
    if (query.dataUpdatedAt === 0 || workspaceId === 'pending') {
      return
    }

    void loadCachedCleaningToday(workspaceId, actorUserId, resolvedDate)
      .then((cachedRead) => {
        if (cachedRead) {
          setSyncFreshness((current) =>
            mergeCleaningFreshness(
              current,
              cacheIdentity,
              cachedRead.lastSuccessfulSyncAt,
            ),
          )
        }
      })
      .catch((error) => {
        console.warn('Failed to read cleaning day sync freshness.', error)
      })
  }, [
    actorUserId,
    cacheIdentity,
    query.dataUpdatedAt,
    resolvedDate,
    workspaceId,
  ])

  return {
    ...query,
    isCacheHydrating: query.data === undefined && isCacheHydrating,
    lastSuccessfulSyncAt,
    readiness: cleaningApi.getReadiness({
      hasCachedData: query.data !== undefined,
    }),
    retrySession: cleaningApi.sessionQuery.refetch,
    sessionError: cleaningApi.sessionQuery.error,
  }
}

export function useCleaningSummary(
  date?: string,
  options: { enabled?: boolean } = {},
) {
  const query = useCleaningToday(date, options)

  return {
    activeZoneCount: query.data?.summary.activeZoneCount ?? 0,
    dueCount: query.data?.summary.dueCount ?? 0,
    error: query.error,
    isLoading: query.isLoading,
    urgentCount: query.data?.summary.urgentCount ?? 0,
  }
}

export function useCreateCleaningZone() {
  const queryClient = useQueryClient()
  const context = useCleaningApi()

  return useMutation({
    mutationFn: async (input: NewCleaningZoneInput) => {
      const dedupeKey = `zone.create:${serializeCleaningWriteKey(input)}`
      const normalized = newCleaningZoneInputSchema.parse({
        ...input,
        id: input.id ?? generateUuidV7(),
      }) as NewCleaningZoneInput & { id: string }
      return executeCleaningWrite({
        context,
        dedupeKey,
        directWrite: (api, operationId) =>
          api.createZone(normalized, { operationId }),
        queryClient,
        queuedWrite: async (expectedWriteGeneration, operationId) => {
          const plan = await enqueueAndSyncCleaningMutation(
            queryClient,
            context,
            {
              actorUserId: context.actorUserId,
              entityKeys: [`zone:${normalized.id}`],
              input: normalized,
              operationId,
              type: 'zone.create',
              workspaceId: context.workspaceId,
              zoneId: normalized.id,
            },
            expectedWriteGeneration,
          )
          const zone = plan.zones.find((item) => item.id === normalized.id)

          if (!zone) {
            throw new Error('Не удалось сохранить локальную зону уборки.')
          }

          return zone
        },
      })
    },
  })
}

export function useUpdateCleaningZone() {
  const queryClient = useQueryClient()
  const context = useCleaningApi()

  return useMutation({
    mutationFn: async ({ input, zoneId }: CleaningZoneUpdateVariables) => {
      const normalized = cleaningZoneUpdateInputSchema.parse(input)
      const readCurrentZone = () =>
        requireCleaningZone(
          requireCurrentCleaningPlan(queryClient, context),
          zoneId,
        )
      return executeCleaningWrite({
        context,
        dedupeKey: `zone.update:${zoneId}:${serializeCleaningWriteKey(normalized)}`,
        directWrite: (api, operationId) => {
          const zone = readCurrentZone()
          return api.updateZone(
            zoneId,
            { ...normalized, expectedVersion: zone.version },
            { operationId },
          )
        },
        queryClient,
        queuedWrite: async (expectedWriteGeneration, operationId) => {
          const zone = readCurrentZone()
          const projected = await enqueueAndSyncCleaningMutation(
            queryClient,
            context,
            {
              actorUserId: context.actorUserId,
              entityKeys: [`zone:${zoneId}`],
              expectedVersion: zone.version,
              input: normalized,
              operationId,
              type: 'zone.update',
              workspaceId: context.workspaceId,
              zoneId,
            },
            expectedWriteGeneration,
          )

          return requireCleaningZone(projected, zoneId)
        },
      })
    },
  })
}

export function useRemoveCleaningZone() {
  const queryClient = useQueryClient()
  const context = useCleaningApi()

  return useMutation({
    mutationFn: async (zoneId: string) => {
      const readCurrentZoneDeleteBase = () => {
        const plan = requireCurrentCleaningPlan(queryClient, context)
        const zone = requireCleaningZone(plan, zoneId)
        return {
          expectedTaskVersions: plan.tasks
            .filter((task) => task.zoneId === zoneId)
            .map((task) => ({ taskId: task.id, version: task.version })),
          zone,
        }
      }
      return executeCleaningWrite({
        context,
        dedupeKey: `zone.delete:${zoneId}`,
        directWrite: (api, operationId) => {
          const { expectedTaskVersions, zone } = readCurrentZoneDeleteBase()
          return api.removeZone(zoneId, {
            expectedTaskVersions,
            expectedVersion: zone.version,
            operationId,
          })
        },
        queryClient,
        queuedWrite: (expectedWriteGeneration, operationId) => {
          const { expectedTaskVersions, zone } = readCurrentZoneDeleteBase()
          return enqueueAndSyncCleaningMutation(
            queryClient,
            context,
            {
              actorUserId: context.actorUserId,
              entityKeys: [
                `zone:${zoneId}`,
                ...expectedTaskVersions.map((task) => `task:${task.taskId}`),
              ],
              expectedTaskVersions,
              expectedVersion: zone.version,
              operationId,
              type: 'zone.delete',
              workspaceId: context.workspaceId,
              zoneId,
            },
            expectedWriteGeneration,
          ).then(() => undefined)
        },
      })
    },
  })
}

export function useCreateCleaningTask() {
  const queryClient = useQueryClient()
  const context = useCleaningApi()

  return useMutation({
    mutationFn: async (input: NewCleaningTaskInput) => {
      const dedupeKey = `task.create:${serializeCleaningWriteKey(input)}`
      const normalized = newCleaningTaskInputSchema.parse({
        ...input,
        id: input.id ?? generateUuidV7(),
      }) as NewCleaningTaskInput & { id: string }
      return executeCleaningWrite({
        context,
        dedupeKey,
        directWrite: (api, operationId) =>
          api.createTask(normalized, { operationId }),
        queryClient,
        queuedWrite: async (expectedWriteGeneration, operationId) => {
          const plan = await enqueueAndSyncCleaningMutation(
            queryClient,
            context,
            {
              actorUserId: context.actorUserId,
              entityKeys: [
                `task:${normalized.id}`,
                ...(normalized.zoneId ? [`zone:${normalized.zoneId}`] : []),
              ],
              input: normalized,
              operationId,
              taskId: normalized.id,
              type: 'task.create',
              workspaceId: context.workspaceId,
            },
            expectedWriteGeneration,
          )
          const task = plan.tasks.find((item) => item.id === normalized.id)

          if (!task) {
            throw new Error('Не удалось сохранить локальную задачу уборки.')
          }

          return task
        },
      })
    },
  })
}

export function useUpdateCleaningTask() {
  const queryClient = useQueryClient()
  const context = useCleaningApi()

  return useMutation({
    mutationFn: async ({ input, taskId }: CleaningTaskUpdateVariables) => {
      const normalized = cleaningTaskUpdateInputSchema.parse(input)
      const readCurrentTask = () =>
        requireCleaningTask(
          requireCurrentCleaningPlan(queryClient, context),
          taskId,
        )
      return executeCleaningWrite({
        context,
        dedupeKey: `task.update:${taskId}:${serializeCleaningWriteKey(normalized)}`,
        directWrite: (api, operationId) => {
          const task = readCurrentTask()
          return api.updateTask(
            taskId,
            { ...normalized, expectedVersion: task.version },
            { operationId },
          )
        },
        queryClient,
        queuedWrite: async (expectedWriteGeneration, operationId) => {
          const task = readCurrentTask()
          const projected = await enqueueAndSyncCleaningMutation(
            queryClient,
            context,
            {
              actorUserId: context.actorUserId,
              entityKeys: [`task:${taskId}`],
              expectedVersion: task.version,
              input: normalized,
              operationId,
              taskId,
              type: 'task.update',
              workspaceId: context.workspaceId,
            },
            expectedWriteGeneration,
          )

          return requireCleaningTask(projected, taskId)
        },
      })
    },
  })
}

export function useRemoveCleaningTask() {
  const queryClient = useQueryClient()
  const context = useCleaningApi()

  return useMutation({
    mutationFn: async (taskId: string) => {
      const readCurrentTask = () =>
        requireCleaningTask(
          requireCurrentCleaningPlan(queryClient, context),
          taskId,
        )
      return executeCleaningWrite({
        context,
        dedupeKey: `task.delete:${taskId}`,
        directWrite: (api, operationId) => {
          const task = readCurrentTask()
          return api.removeTask(taskId, {
            expectedVersion: task.version,
            operationId,
          })
        },
        queryClient,
        queuedWrite: (expectedWriteGeneration, operationId) => {
          const task = readCurrentTask()
          return enqueueAndSyncCleaningMutation(
            queryClient,
            context,
            {
              actorUserId: context.actorUserId,
              entityKeys: [`task:${taskId}`],
              expectedVersion: task.version,
              operationId,
              taskId,
              type: 'task.delete',
              workspaceId: context.workspaceId,
            },
            expectedWriteGeneration,
          ).then(() => undefined)
        },
      })
    },
  })
}

export function useCompleteCleaningTask() {
  return useCleaningTaskAction('completed')
}

export function usePostponeCleaningTask() {
  return useCleaningTaskAction('postponed')
}

export function useSkipCleaningTask() {
  return useCleaningTaskAction('skipped')
}

export function useSeedCleaningTemplates() {
  const queryClient = useQueryClient()
  const context = useCleaningApi()

  return useMutation({
    mutationFn: async (input: CleaningSeedInput) => {
      const normalized = cleaningSeedInputSchema.parse(input)
      return executeCleaningWrite({
        context,
        dedupeKey: `cleaning.seed:${serializeCleaningWriteKey(normalized)}`,
        directWrite: (api, operationId) =>
          api.seed(normalized, { operationId }),
        queryClient,
        queuedWrite: (expectedWriteGeneration, operationId) =>
          enqueueAndSyncCleaningMutation(
            queryClient,
            context,
            {
              actorUserId: context.actorUserId,
              entityKeys: normalized.zones.flatMap((entry) => [
                `zone:${entry.zone.id}`,
                ...entry.tasks.map((task) => `task:${task.id}`),
              ]),
              input: normalized,
              operationId,
              type: 'cleaning.seed',
              workspaceId: context.workspaceId,
            },
            expectedWriteGeneration,
          ),
      })
    },
  })
}

function useCleaningTaskAction(action: CleaningTaskHistoryAction) {
  const queryClient = useQueryClient()
  const context = useCleaningApi()
  const plannerTimeZone = usePlannerTimeZone()

  return useMutation<
    CleaningTaskActionResponse,
    Error,
    CleaningTaskActionVariables
  >({
    mutationFn: async ({ input, taskId }) => {
      const normalized = cleaningTaskActionInputSchema.parse({
        ...input,
        date: input?.date ?? getTodayDate(plannerTimeZone),
        occurredAt: input?.occurredAt ?? new Date().toISOString(),
      }) as CleaningTaskActionInput & { date: string; occurredAt: string }
      const readCurrentActionBase = () => {
        const plan = requireCurrentCleaningPlan(queryClient, context)
        const task = requireCleaningTask(plan, taskId)
        const state =
          plan.states.find((item) => item.taskId === taskId) ??
          createInitialCleaningState(task, context.workspaceId)
        return { state, task }
      }
      return executeCleaningWrite({
        context,
        dedupeKey: `task.action:${taskId}:${action}:${normalized.date}`,
        directWrite: (api, operationId) => {
          const { state, task } = readCurrentActionBase()
          const actionInput = {
            ...normalized,
            expectedStateVersion: state.version,
            expectedTaskVersion: task.version,
          }
          return action === 'completed'
            ? api.completeTask(taskId, actionInput, { operationId })
            : action === 'postponed'
              ? api.postponeTask(taskId, actionInput, { operationId })
              : api.skipTask(taskId, actionInput, { operationId })
        },
        queryClient,
        queuedWrite: async (expectedWriteGeneration, operationId) => {
          const { state, task } = readCurrentActionBase()
          const projected = await enqueueAndSyncCleaningMutation(
            queryClient,
            context,
            {
              action,
              actorUserId: context.actorUserId,
              entityKeys: [`task:${taskId}`],
              expectedStateVersion: state.version,
              expectedTaskVersion: task.version,
              input: normalized,
              operationId,
              taskId,
              type: 'task.action',
              workspaceId: context.workspaceId,
            },
            expectedWriteGeneration,
          )
          const projectedState =
            projected.states.find((item) => item.taskId === taskId) ?? state
          const historyItem = projected.history.find(
            (item) =>
              item.taskId === taskId &&
              item.date === normalized.date &&
              item.action === action,
          )

          if (!historyItem) {
            throw new Error('Не удалось сохранить действие с уборкой.')
          }

          return { historyItem, state: projectedState }
        },
      })
    },
  })
}

function useCleaningQueueControls(input: {
  actorUserId: string
  api: CleaningApiClient | null
  canDrain: boolean
  canQueueWrites: boolean
  queryClient: QueryClient
  retrySession: () => unknown
  workspaceId: string
}) {
  const {
    actorUserId,
    api,
    canDrain,
    canQueueWrites,
    queryClient,
    retrySession,
    workspaceId,
  } = input
  const scopeIdentity = `${workspaceId}:${actorUserId}`
  const currentScopeRef = useRef(scopeIdentity)
  useLayoutEffect(() => {
    currentScopeRef.current = scopeIdentity
  }, [scopeIdentity])
  const emptyCounts: CleaningOfflineQueueCounts = {
    conflicted: 0,
    failed: 0,
    pending: 0,
  }
  const [countsState, setCountsState] = useState({
    scopeIdentity,
    value: emptyCounts,
  })
  const [drainingState, setDrainingState] = useState({
    scopeIdentity,
    value: false,
  })
  const [storageHealthState, setStorageHealthState] = useState({
    scopeIdentity,
    value: getCleaningOfflineStorageHealth(),
  })
  const counts =
    countsState.scopeIdentity === scopeIdentity
      ? countsState.value
      : emptyCounts
  const isDraining =
    drainingState.scopeIdentity === scopeIdentity ? drainingState.value : false
  const storageHealth =
    storageHealthState.scopeIdentity === scopeIdentity
      ? storageHealthState.value
      : getCleaningOfflineStorageHealth()
  const isCurrentScope = useCallback(
    () => currentScopeRef.current === scopeIdentity,
    [scopeIdentity],
  )
  const commitCounts = useCallback(
    (value: CleaningOfflineQueueCounts) => {
      if (isCurrentScope()) {
        setCountsState((current) =>
          current.scopeIdentity === scopeIdentity &&
          current.value.conflicted === value.conflicted &&
          current.value.failed === value.failed &&
          current.value.pending === value.pending
            ? current
            : { scopeIdentity, value },
        )
      }
    },
    [isCurrentScope, scopeIdentity],
  )
  const refreshCounts = useCallback(async () => {
    if (workspaceId === 'pending' || actorUserId === 'pending') {
      commitCounts({ conflicted: 0, failed: 0, pending: 0 })
      return
    }

    try {
      const nextCounts = await getCleaningOfflineQueueCounts(
        workspaceId,
        actorUserId,
      )
      commitCounts(nextCounts)
    } catch (error) {
      console.warn('Failed to read the cleaning offline queue.', error)
    }
  }, [actorUserId, commitCounts, workspaceId])
  const drain = useCallback(async () => {
    if (
      !api ||
      !canDrain ||
      workspaceId === 'pending' ||
      actorUserId === 'pending' ||
      (typeof navigator !== 'undefined' && navigator.onLine === false)
    ) {
      await refreshCounts()
      return null
    }

    if (isCurrentScope()) {
      setDrainingState((current) =>
        current.scopeIdentity === scopeIdentity && current.value
          ? current
          : { scopeIdentity, value: true },
      )
    }

    try {
      const result = await cleaningDrainCoordinator.drain(
        `${workspaceId}:${actorUserId}`,
        () =>
          drainCleaningOfflineQueue({
            actorUserId,
            api,
            workspaceId,
          }),
      )

      if (result.unauthorized) {
        await retrySession()
      }

      await hydrateCleaningQueriesFromCache(queryClient, {
        actorUserId,
        workspaceId,
      }).catch(() => null)
      await refreshCounts()
      return result
    } finally {
      if (isCurrentScope()) {
        setDrainingState((current) =>
          current.scopeIdentity === scopeIdentity && !current.value
            ? current
            : { scopeIdentity, value: false },
        )
      }
    }
  }, [
    actorUserId,
    api,
    canDrain,
    isCurrentScope,
    queryClient,
    refreshCounts,
    retrySession,
    scopeIdentity,
    workspaceId,
  ])
  const discardConflicts = useCallback(async () => {
    await discardConflictedCleaningMutations(workspaceId, actorUserId)
    await hydrateCleaningQueriesFromCache(queryClient, {
      actorUserId,
      workspaceId,
    }).catch(() => null)
    await refreshCounts()
  }, [actorUserId, queryClient, refreshCounts, workspaceId])
  const refreshAndRetryConflicts = useCallback(async () => {
    if (!api || !canDrain) {
      await refreshCounts()
      return null
    }

    await queryClient.refetchQueries({
      exact: true,
      queryKey: cleaningQueryKey(workspaceId, actorUserId),
    })
    await retryConflictedCleaningMutations(workspaceId, actorUserId)
    await hydrateCleaningQueriesFromCache(queryClient, {
      actorUserId,
      workspaceId,
    }).catch(() => null)
    return drain()
  }, [
    actorUserId,
    api,
    canDrain,
    drain,
    queryClient,
    refreshCounts,
    workspaceId,
  ])

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refreshCounts()
    }, 0)
    const unsubscribe = subscribeCleaningOfflineQueue(() => {
      if (isCurrentScope()) {
        const value = getCleaningOfflineStorageHealth()
        setStorageHealthState((current) =>
          current.scopeIdentity === scopeIdentity && current.value === value
            ? current
            : { scopeIdentity, value },
        )
      }
      void refreshCounts()
    })
    void probeCleaningOfflineStorage().then((value) => {
      if (isCurrentScope()) {
        setStorageHealthState((current) =>
          current.scopeIdentity === scopeIdentity && current.value === value
            ? current
            : { scopeIdentity, value },
        )
      }
    })

    return () => {
      window.clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [isCurrentScope, refreshCounts, scopeIdentity])

  useOfflineQueueDrain({
    drain,
    enabled: canDrain && Boolean(api),
  })

  return {
    ...counts,
    canWriteFromSession: canQueueWrites,
    canQueueWrites: canQueueWrites && storageHealth === 'ready',
    discardConflicts,
    isDraining,
    refreshAndRetryConflicts,
    retry: drain,
  }
}

export function getCleaningErrorMessage(error: unknown): string {
  if (error instanceof CleaningWriteUnavailableError) {
    return error.message
  }

  if (isCleaningConnectionError(error)) {
    return 'Нет соединения. Изменение не отправлено на сервер — подключитесь и повторите.'
  }

  if (error instanceof CleaningApiError) {
    return error.code === 'cleaning_request_failed'
      ? 'Не удалось выполнить запрос к уборке. Повторите попытку.'
      : error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Не удалось сохранить уборку.'
}

export function isCleaningConnectionError(error: unknown): boolean {
  return (
    !(error instanceof CleaningApiError) &&
    isBrowserRetryableOfflineError(error)
  )
}

function useCleaningApi(options: { enabled?: boolean } = {}) {
  const {
    apiConfig,
    getReadiness,
    isApiEnabled,
    readiness,
    session,
    sessionQuery,
    workspaceId,
  } = useSessionFeatureReadiness({
    enabled: options.enabled,
  })
  const apiAccessToken = apiConfig?.accessToken
  const apiActorUserId = apiConfig?.actorUserId
  const apiBaseUrl = apiConfig?.apiBaseUrl
  const apiWorkspaceId = apiConfig?.workspaceId
  const api = useMemo(
    () =>
      apiActorUserId && apiBaseUrl && apiWorkspaceId
        ? createCleaningApiClient({
            ...(apiAccessToken === undefined
              ? {}
              : { accessToken: apiAccessToken }),
            actorUserId: apiActorUserId,
            apiBaseUrl,
            workspaceId: apiWorkspaceId,
          })
        : null,
    [apiAccessToken, apiActorUserId, apiBaseUrl, apiWorkspaceId],
  )

  return {
    actorUserId: session?.actorUserId ?? 'pending',
    api,
    canQueueOfflineWrites: canSessionWriteCleaning(session),
    getReadiness,
    isEnabled: isApiEnabled,
    readiness,
    session,
    sessionQuery,
    workspaceId,
  }
}

function requireCleaningApi(api: CleaningApiClient | null): CleaningApiClient {
  if (!api) {
    throw new Error('Cleaning API is not ready.')
  }

  return api
}

class CleaningWriteUnavailableError extends Error {
  constructor(
    message = 'Сейчас изменение нельзя надёжно сохранить. Подключитесь к сети и повторите.',
  ) {
    super(message)
    this.name = 'CleaningWriteUnavailableError'
  }
}

type CleaningApiContext = ReturnType<typeof useCleaningApi>

async function getDirectCleaningWriteApi(
  context: CleaningApiContext,
  queryClient: QueryClient,
  expectedWriteGeneration: number,
): Promise<CleaningApiClient | null> {
  if (!context.canQueueOfflineWrites) {
    throw new CleaningWriteUnavailableError(
      'У вас нет права изменять уборку в этом пространстве.',
    )
  }

  const hasCurrentPlan = Boolean(
    queryClient.getQueryData<CleaningListResponse>(
      cleaningQueryKey(context.workspaceId, context.actorUserId),
    ),
  )
  const storageHealth = await probeCleaningOfflineStorage()

  assertCleaningWriteGenerationCurrent(context, expectedWriteGeneration)

  if (
    context.canQueueOfflineWrites &&
    storageHealth === 'ready' &&
    hasCurrentPlan
  ) {
    return null
  }

  if (
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    !context.api ||
    !context.readiness.canWriteProtectedData
  ) {
    throw new CleaningWriteUnavailableError(
      context.canQueueOfflineWrites && !hasCurrentPlan
        ? 'Чтобы сохранять уборку без сети, сначала откройте этот раздел при подключении.'
        : undefined,
    )
  }

  return context.api
}

async function enqueueAndSyncCleaningMutation(
  queryClient: QueryClient,
  context: CleaningApiContext,
  input: CleaningOfflineMutationInput,
  expectedWriteGeneration: number,
): Promise<CleaningListResponse> {
  if (!context.canQueueOfflineWrites) {
    throw new CleaningWriteUnavailableError(
      'У вас нет права изменять уборку в этом пространстве.',
    )
  }

  assertCleaningWriteGenerationCurrent(context, expectedWriteGeneration)

  if (!isCleaningOfflineStorageReady()) {
    throw new CleaningOfflineMutationNotPersistedError(
      new CleaningWriteUnavailableError(),
    )
  }

  const currentPlan = requireCurrentCleaningPlan(queryClient, context)
  try {
    const cached = await loadCachedCleaningPlan(
      context.workspaceId,
      context.actorUserId,
    )

    assertCleaningWriteGenerationCurrent(context, expectedWriteGeneration)

    if (!cached) {
      await replaceCachedCleaningPlan(
        context.workspaceId,
        context.actorUserId,
        currentPlan,
        new Date().toISOString(),
        expectedWriteGeneration,
      )
    }

    assertCleaningWriteGenerationCurrent(context, expectedWriteGeneration)
    await enqueueCleaningOfflineMutation(input, expectedWriteGeneration)
  } catch (error) {
    if (
      error instanceof CleaningOfflineMutationNotPersistedError ||
      (!(error instanceof CleaningOfflineGenerationInvalidatedError) &&
        ['failed', 'unavailable'].includes(getCleaningOfflineStorageHealth()))
    ) {
      throw new CleaningOfflineMutationNotPersistedError(error)
    }

    throw error
  }

  const projected = await hydrateCleaningQueriesFromCache(queryClient, context)
  scheduleCleaningOfflineDrain(queryClient, context)
  return projected
}

function scheduleCleaningOfflineDrain(
  queryClient: QueryClient,
  context: CleaningApiContext,
): void {
  if (
    !context.api ||
    !context.readiness.canWriteProtectedData ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  ) {
    return
  }

  const scopeKey = `${context.workspaceId}:${context.actorUserId}`
  void cleaningDrainCoordinator
    .drain(scopeKey, () =>
      drainCleaningOfflineQueue({
        actorUserId: context.actorUserId,
        api: context.api!,
        workspaceId: context.workspaceId,
      }),
    )
    .then(() => hydrateCleaningQueriesFromCache(queryClient, context))
    .catch((error: unknown) => {
      console.warn('Failed to synchronize queued cleaning changes.', error)
    })
}

async function executeCleaningWrite<T>(input: {
  context: CleaningApiContext
  dedupeKey: string
  directWrite: (api: CleaningApiClient, operationId: string) => Promise<T>
  queryClient: QueryClient
  queuedWrite: (
    expectedWriteGeneration: number,
    operationId: string,
  ) => Promise<T>
}): Promise<T> {
  const { context, dedupeKey, directWrite, queryClient, queuedWrite } = input
  const scopeKey = `${context.workspaceId}:${context.actorUserId}`
  const scopedDedupeKey = `${context.workspaceId}:${context.actorUserId}:${dedupeKey}`

  return runCleaningWriteOnce(scopedDedupeKey, () =>
    runCleaningWriteSerially(scopeKey, async () => {
      const expectedWriteGeneration =
        getCleaningOfflineWorkspaceWriteGeneration(context.workspaceId)
      const operationId = generateUuidV7()
      const directApi = await getDirectCleaningWriteApi(
        context,
        queryClient,
        expectedWriteGeneration,
      )

      if (directApi) {
        const result = await directWrite(directApi, operationId)
        await invalidateCleaning(queryClient, context.workspaceId)
        return result
      }

      try {
        return await queuedWrite(expectedWriteGeneration, operationId)
      } catch (error) {
        if (
          !(error instanceof CleaningOfflineMutationNotPersistedError) ||
          !context.api ||
          !context.readiness.canWriteProtectedData ||
          (typeof navigator !== 'undefined' && navigator.onLine === false)
        ) {
          throw error
        }

        assertCleaningWriteGenerationCurrent(context, expectedWriteGeneration)
        const result = await directWrite(context.api, operationId)
        await invalidateCleaning(queryClient, context.workspaceId)
        return result
      }
    }),
  )
}

function runCleaningWriteOnce<T>(
  key: string,
  write: () => Promise<T>,
): Promise<T> {
  const active = cleaningInFlightWrites.get(key)

  if (active) {
    return active as Promise<T>
  }

  const pending = write().finally(() => {
    if (cleaningInFlightWrites.get(key) === pending) {
      cleaningInFlightWrites.delete(key)
    }
  })
  cleaningInFlightWrites.set(key, pending)
  return pending
}

function runCleaningWriteSerially<T>(
  scopeKey: string,
  write: () => Promise<T>,
): Promise<T> {
  const previous = cleaningWriteTails.get(scopeKey) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(write)
  const tail = result.then(
    () => undefined,
    () => undefined,
  )
  cleaningWriteTails.set(scopeKey, tail)
  void tail.finally(() => {
    if (cleaningWriteTails.get(scopeKey) === tail) {
      cleaningWriteTails.delete(scopeKey)
    }
  })
  return result
}

function serializeCleaningWriteKey(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(serializeCleaningWriteKey).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${serializeCleaningWriteKey(entry)}`,
      )
      .join(',')}}`
  }

  return JSON.stringify(value) ?? String(value)
}

function assertCleaningWriteGenerationCurrent(
  context: CleaningApiContext,
  expectedWriteGeneration: number,
): void {
  if (
    !isCleaningOfflineWorkspaceWriteGenerationCurrent(
      context.workspaceId,
      expectedWriteGeneration,
    )
  ) {
    throw new CleaningOfflineGenerationInvalidatedError()
  }
}

function requireCurrentCleaningPlan(
  queryClient: QueryClient,
  context: CleaningApiContext,
): CleaningListResponse {
  const plan = queryClient.getQueryData<CleaningListResponse>(
    cleaningQueryKey(context.workspaceId, context.actorUserId),
  )

  if (!plan) {
    throw new CleaningWriteUnavailableError(
      'Данные уборки ещё не загружены. Дождитесь загрузки и повторите.',
    )
  }

  return plan
}

function requireCleaningZone(
  plan: CleaningListResponse,
  zoneId: string,
): CleaningZoneRecord {
  const zone = plan.zones.find((item) => item.id === zoneId)

  if (!zone) {
    throw new Error('Зона уборки больше недоступна.')
  }

  return zone
}

function requireCleaningTask(
  plan: CleaningListResponse,
  taskId: string,
): CleaningTaskRecord {
  const task = plan.tasks.find((item) => item.id === taskId)

  if (!task) {
    throw new Error('Задача уборки больше недоступна.')
  }

  return task
}

function createInitialCleaningState(
  task: CleaningTaskRecord,
  workspaceId: string,
): CleaningTaskStateRecord {
  return {
    lastCompletedAt: null,
    lastPostponedAt: null,
    lastSkippedAt: null,
    nextDueAt: null,
    postponeCount: 0,
    taskId: task.id,
    updatedAt: task.updatedAt,
    version: 1,
    workspaceId,
  }
}

async function hydrateCleaningQueriesFromCache(
  queryClient: QueryClient,
  context: Pick<CleaningApiContext, 'actorUserId' | 'workspaceId'>,
): Promise<CleaningListResponse> {
  const cached = await loadCachedCleaningPlan(
    context.workspaceId,
    context.actorUserId,
  )

  if (!cached) {
    throw new CleaningWriteUnavailableError()
  }

  queryClient.setQueryData(
    cleaningQueryKey(context.workspaceId, context.actorUserId),
    cached.data,
  )
  queryClient.setQueriesData<CleaningTodayResponse>(
    {
      predicate: (query) =>
        query.queryKey[0] === 'cleaning' &&
        query.queryKey[1] === context.workspaceId &&
        query.queryKey[2] === context.actorUserId &&
        query.queryKey[3] === 'today',
    },
    (current) =>
      current ? projectCleaningToday(current, cached.data) : current,
  )

  return cached.data
}

export function canSessionWriteCleaning(
  session: SessionResponse | undefined,
): boolean {
  if (!session) {
    return false
  }

  if (session.workspace.kind === 'shared') {
    return (
      session.role === 'owner' ||
      session.groupRole === 'group_admin' ||
      session.groupRole === 'senior_member' ||
      session.groupRole === 'member'
    )
  }

  return session.role !== 'guest'
}

function getCleaningFreshness(
  freshness: CleaningSyncFreshness | null,
  cacheIdentity: string,
): string | null {
  return freshness?.cacheIdentity === cacheIdentity
    ? freshness.lastSuccessfulSyncAt
    : null
}

function mergeCleaningFreshness(
  current: CleaningSyncFreshness | null,
  cacheIdentity: string,
  candidate: string,
): CleaningSyncFreshness {
  const currentTimestamp = getCleaningFreshness(current, cacheIdentity)

  return {
    cacheIdentity,
    lastSuccessfulSyncAt:
      !currentTimestamp || candidate > currentTimestamp
        ? candidate
        : currentTimestamp,
  }
}

async function invalidateCleaning(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: ['cleaning', workspaceId],
  })
}

export type { CleaningListResponse, CleaningTodayResponse }
