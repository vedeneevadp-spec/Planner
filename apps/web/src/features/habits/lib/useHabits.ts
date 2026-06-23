import {
  generateUuidV7,
  type HabitEntryDeleteInput,
  type HabitEntryUpsertInput,
  type HabitRecord,
  type HabitStatsResponse,
  type HabitTodayResponse,
  type HabitUpdateInput,
  type NewHabitInput,
} from '@planner/contracts'
import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'

import {
  usePlannerTimeZone,
  useSessionFeatureReadiness,
} from '@/features/session'
import {
  createOfflineDrainCoordinator,
  useOfflineQueueDrain,
} from '@/shared/lib/offline-sync'
import { getTodayDate } from '@/shared/time/time.service'

import {
  applyHabitUpdate,
  createFallbackStatsResponse,
  createFallbackTodayResponse,
  createOptimisticHabit,
  createOptimisticHabitEntry,
  removeEntryInTodayResponse,
  removeHabitFromTodayResponse,
  removeHabitRecord,
  replaceHabitRecord,
  sortHabitRecords,
  upsertEntryInTodayResponse,
  upsertHabitInTodayResponse,
} from './habit-projection-model'
import {
  habitOfflineStatusQueryKey,
  habitsQueryKey,
  habitStatsQueryKey,
  habitsTodayQueryKey,
} from './habit-query-keys'
import {
  createHabitsApiClient,
  type HabitsApiClient,
  HabitsApiError,
} from './habits-api'
import {
  countConflictedHabitOfflineMutations,
  countRetryableHabitOfflineMutations,
  enqueueHabitOfflineMutation,
  isHabitOfflineStorageAvailable,
  loadCachedHabitRecords,
  loadCachedHabitStatsResponse,
  loadCachedHabitTodayResponse,
  removeCachedHabitFromTodayResponses,
  removeCachedHabitRecord,
  replaceCachedHabitRecords,
  replaceCachedHabitStatsResponse,
  replaceCachedHabitTodayResponse,
  upsertCachedHabitInTodayResponses,
  upsertCachedHabitRecord,
} from './offline-habit-store'
import {
  drainHabitOfflineQueue,
  type HabitOfflineDrainResult,
  isQueueableHabitMutationError,
} from './offline-habit-sync'

interface HabitEntryMutationVariables {
  date: string
  habitId: string
  input: HabitEntryUpsertInput
}

interface HabitEntryRemoveVariables {
  date: string
  habitId: string
  input?: HabitEntryDeleteInput | undefined
}

interface HabitOfflineStatus {
  conflictedMutationCount: number
  queuedMutationCount: number
}

interface HabitUpdateVariables {
  habitId: string
  input: HabitUpdateInput
}

type HabitTodayQuerySnapshot = [QueryKey, HabitTodayResponse | undefined]

const habitDrainCoordinator = createOfflineDrainCoordinator<
  string,
  HabitOfflineDrainResult
>()

export function useHabits(options: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient()
  const { api, isEnabled, workspaceId } = useHabitsApi(options)
  const queryKey = useMemo(() => habitsQueryKey(workspaceId), [workspaceId])

  useEffect(() => {
    if (options.enabled === false || workspaceId === 'pending') {
      return
    }

    let isActive = true

    void loadCachedHabitRecords(workspaceId).then((cachedHabits) => {
      if (!isActive || cachedHabits.length === 0) {
        return
      }

      queryClient.setQueryData<HabitRecord[]>(
        queryKey,
        (currentHabits) => currentHabits ?? cachedHabits,
      )
    })

    return () => {
      isActive = false
    }
  }, [options.enabled, queryClient, queryKey, workspaceId])

  useEffect(() => {
    if (!api || !isEnabled) {
      return
    }

    void drainQueuedHabitMutations({
      api,
      queryClient,
      workspaceId,
    })
  }, [api, isEnabled, queryClient, workspaceId])

  useOnlineHabitSync({
    api,
    enabled: isEnabled,
    queryClient,
    workspaceId,
  })

  return useQuery({
    enabled: isEnabled,
    queryFn: async ({ signal }) => {
      const habitsApi = requireHabitsApi(api)

      try {
        await drainQueuedHabitMutations({
          api: habitsApi,
          queryClient,
          workspaceId,
        })

        const habits = await habitsApi.listHabits(signal)

        await replaceCachedHabitRecords(workspaceId, habits)

        return habits
      } catch (error) {
        if (isQueueableHabitMutationError(error)) {
          return loadCachedHabitRecords(workspaceId)
        }

        throw error
      }
    },
    queryKey,
    retry: (failureCount, error) =>
      !isQueueableHabitMutationError(error) && failureCount < 2,
    staleTime: 30_000,
  })
}

export function useHabitsToday(
  date?: string,
  options: { enabled?: boolean } = {},
) {
  const queryClient = useQueryClient()
  const { api, isEnabled, workspaceId } = useHabitsApi(options)
  const plannerTimeZone = usePlannerTimeZone()
  const resolvedDate = date ?? getTodayDate(plannerTimeZone)
  const queryKey = useMemo(
    () => habitsTodayQueryKey(workspaceId, resolvedDate),
    [resolvedDate, workspaceId],
  )

  useEffect(() => {
    if (options.enabled === false || workspaceId === 'pending') {
      return
    }

    let isActive = true

    void loadCachedHabitTodayOrFallback(workspaceId, resolvedDate).then(
      (response) => {
        if (!isActive) {
          return
        }

        queryClient.setQueryData<HabitTodayResponse>(
          queryKey,
          (currentResponse) => currentResponse ?? response,
        )
      },
    )

    return () => {
      isActive = false
    }
  }, [options.enabled, queryClient, queryKey, resolvedDate, workspaceId])

  useEffect(() => {
    if (!api || !isEnabled) {
      return
    }

    void drainQueuedHabitMutations({
      api,
      queryClient,
      workspaceId,
    })
  }, [api, isEnabled, queryClient, workspaceId])

  useOnlineHabitSync({
    api,
    enabled: isEnabled,
    queryClient,
    workspaceId,
  })

  return useQuery({
    enabled: isEnabled,
    queryFn: async ({ signal }) => {
      const habitsApi = requireHabitsApi(api)

      try {
        await drainQueuedHabitMutations({
          api: habitsApi,
          queryClient,
          workspaceId,
        })

        const response = await habitsApi.getToday(resolvedDate, signal)

        await replaceCachedHabitTodayResponse(
          workspaceId,
          resolvedDate,
          response,
        )

        return response
      } catch (error) {
        if (isQueueableHabitMutationError(error)) {
          return loadCachedHabitTodayOrFallback(workspaceId, resolvedDate)
        }

        throw error
      }
    },
    queryKey,
    retry: (failureCount, error) =>
      !isQueueableHabitMutationError(error) && failureCount < 2,
    staleTime: 30_000,
  })
}

export function useHabitStats(
  from: string,
  to: string,
  options: { enabled?: boolean } = {},
) {
  const queryClient = useQueryClient()
  const { api, isEnabled, workspaceId } = useHabitsApi(options)
  const queryKey = useMemo(
    () => habitStatsQueryKey(workspaceId, from, to),
    [from, to, workspaceId],
  )

  useEffect(() => {
    if (options.enabled === false || workspaceId === 'pending') {
      return
    }

    let isActive = true

    void loadCachedHabitStatsOrFallback(workspaceId, from, to).then(
      (response) => {
        if (!isActive) {
          return
        }

        queryClient.setQueryData<HabitStatsResponse>(
          queryKey,
          (currentResponse) => currentResponse ?? response,
        )
      },
    )

    return () => {
      isActive = false
    }
  }, [from, options.enabled, queryClient, queryKey, to, workspaceId])

  useEffect(() => {
    if (!api || !isEnabled) {
      return
    }

    void drainQueuedHabitMutations({
      api,
      queryClient,
      workspaceId,
    })
  }, [api, isEnabled, queryClient, workspaceId])

  useOnlineHabitSync({
    api,
    enabled: isEnabled,
    queryClient,
    workspaceId,
  })

  return useQuery({
    enabled: isEnabled,
    queryFn: async ({ signal }) => {
      const habitsApi = requireHabitsApi(api)

      try {
        await drainQueuedHabitMutations({
          api: habitsApi,
          queryClient,
          workspaceId,
        })

        const response = await habitsApi.getStats(from, to, signal)

        await replaceCachedHabitStatsResponse(workspaceId, from, to, response)

        return response
      } catch (error) {
        if (isQueueableHabitMutationError(error)) {
          return loadCachedHabitStatsOrFallback(workspaceId, from, to)
        }

        throw error
      }
    },
    queryKey,
    retry: (failureCount, error) =>
      !isQueueableHabitMutationError(error) && failureCount < 2,
    staleTime: 30_000,
  })
}

export function useHabitSyncStatus() {
  const queryClient = useQueryClient()
  const { api, isEnabled, workspaceId } = useHabitsApi()
  const queryKey = useMemo(
    () => habitOfflineStatusQueryKey(workspaceId),
    [workspaceId],
  )
  const statusQuery = useQuery({
    enabled: isEnabled,
    queryFn: () => loadHabitOfflineStatus(workspaceId),
    queryKey,
    refetchInterval: 10_000,
    staleTime: 5_000,
  })
  const retryMutation = useMutation({
    mutationFn: async () => {
      await drainQueuedHabitMutations({
        api: requireHabitsApi(api),
        queryClient,
        workspaceId,
      })

      return loadHabitOfflineStatus(workspaceId)
    },
    onSuccess: (status) => {
      queryClient.setQueryData(queryKey, status)
    },
  })
  const retry = useCallback(() => retryMutation.mutateAsync(), [retryMutation])

  useOnlineHabitSync({
    api,
    enabled: isEnabled,
    queryClient,
    retry,
    workspaceId,
  })

  return {
    conflictedMutationCount: statusQuery.data?.conflictedMutationCount ?? 0,
    error: statusQuery.error ?? retryMutation.error,
    isPending: statusQuery.isPending,
    isSyncing: retryMutation.isPending,
    queuedMutationCount: statusQuery.data?.queuedMutationCount ?? 0,
    retry,
  }
}

export function useCreateHabit() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useHabitsApi()
  const plannerTimeZone = usePlannerTimeZone()
  const queryKey = useMemo(() => habitsQueryKey(workspaceId), [workspaceId])

  return useMutation({
    mutationFn: async (input: NewHabitInput) => {
      if (!session) {
        throw new Error('Planner session is required to create habits.')
      }

      const habitId = input.id ?? generateUuidV7()
      const inputWithId = {
        ...input,
        id: habitId,
      }
      const previousHabits =
        queryClient.getQueryData<HabitRecord[]>(queryKey) ??
        (await loadCachedHabitRecords(workspaceId))
      const previousTodaySnapshots = getHabitTodayQuerySnapshots(
        queryClient,
        workspaceId,
      )
      const optimisticHabit = createOptimisticHabit(inputWithId, {
        actorUserId: session.actorUserId,
        plannerTimeZone,
        sortOrder: previousHabits.length,
        workspaceId,
      })

      queryClient.setQueryData<HabitRecord[]>(queryKey, (current = []) =>
        sortHabitRecords(replaceHabitRecord(current, optimisticHabit)),
      )
      upsertHabitInTodayQueries(queryClient, workspaceId, optimisticHabit)
      await upsertCachedHabitRecord(workspaceId, optimisticHabit)
      await upsertCachedHabitInTodayResponses(workspaceId, optimisticHabit)

      try {
        const createdHabit =
          await requireHabitsApi(api).createHabit(inputWithId)

        queryClient.setQueryData<HabitRecord[]>(queryKey, (current = []) =>
          sortHabitRecords(replaceHabitRecord(current, createdHabit)),
        )
        upsertHabitInTodayQueries(queryClient, workspaceId, createdHabit)
        await upsertCachedHabitRecord(workspaceId, createdHabit)
        await upsertCachedHabitInTodayResponses(workspaceId, createdHabit)
        await invalidateHabits(queryClient, workspaceId)

        return createdHabit
      } catch (error) {
        if (shouldKeepOptimisticHabitMutation(error)) {
          await enqueueHabitOfflineMutation({
            actorUserId: session.actorUserId,
            habitId,
            input: inputWithId,
            type: 'habit.create',
            workspaceId,
          })
          await refreshHabitOfflineStatus(queryClient, workspaceId)

          return optimisticHabit
        }

        await restoreHabitRecords({
          habits: previousHabits,
          queryClient,
          queryKey,
          todaySnapshots: previousTodaySnapshots,
          workspaceId,
        })

        throw error
      }
    },
  })
}

export function useUpdateHabit() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useHabitsApi()
  const queryKey = useMemo(() => habitsQueryKey(workspaceId), [workspaceId])

  return useMutation({
    mutationFn: async ({ habitId, input }: HabitUpdateVariables) => {
      if (!session) {
        throw new Error('Planner session is required to update habits.')
      }

      const previousHabits =
        queryClient.getQueryData<HabitRecord[]>(queryKey) ??
        (await loadCachedHabitRecords(workspaceId))
      const currentHabit = previousHabits.find((habit) => habit.id === habitId)

      if (!currentHabit) {
        throw new Error(`Habit "${habitId}" was not found.`)
      }

      const previousTodaySnapshots = getHabitTodayQuerySnapshots(
        queryClient,
        workspaceId,
      )
      const optimisticHabit = applyHabitUpdate(currentHabit, input)

      queryClient.setQueryData<HabitRecord[]>(queryKey, (current = []) =>
        sortHabitRecords(replaceHabitRecord(current, optimisticHabit)),
      )
      upsertHabitInTodayQueries(queryClient, workspaceId, optimisticHabit)
      await upsertCachedHabitRecord(workspaceId, optimisticHabit)
      await upsertCachedHabitInTodayResponses(workspaceId, optimisticHabit)

      try {
        const updatedHabit = await requireHabitsApi(api).updateHabit(
          habitId,
          input,
        )

        queryClient.setQueryData<HabitRecord[]>(queryKey, (current = []) =>
          sortHabitRecords(replaceHabitRecord(current, updatedHabit)),
        )
        upsertHabitInTodayQueries(queryClient, workspaceId, updatedHabit)
        await upsertCachedHabitRecord(workspaceId, updatedHabit)
        await upsertCachedHabitInTodayResponses(workspaceId, updatedHabit)
        await invalidateHabits(queryClient, workspaceId)

        return updatedHabit
      } catch (error) {
        if (shouldKeepOptimisticHabitMutation(error)) {
          await enqueueHabitOfflineMutation({
            actorUserId: session.actorUserId,
            habitId,
            input,
            type: 'habit.update',
            workspaceId,
          })
          await refreshHabitOfflineStatus(queryClient, workspaceId)

          return optimisticHabit
        }

        await restoreHabitRecords({
          habits: previousHabits,
          queryClient,
          queryKey,
          todaySnapshots: previousTodaySnapshots,
          workspaceId,
        })

        if (isHabitVersionConflict(error)) {
          await invalidateHabits(queryClient, workspaceId)
        }

        throw error
      }
    },
  })
}

export function useRemoveHabit() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useHabitsApi()
  const queryKey = useMemo(() => habitsQueryKey(workspaceId), [workspaceId])

  return useMutation({
    mutationFn: async (habitId: string) => {
      if (!session) {
        throw new Error('Planner session is required to remove habits.')
      }

      const previousHabits =
        queryClient.getQueryData<HabitRecord[]>(queryKey) ??
        (await loadCachedHabitRecords(workspaceId))
      const previousTodaySnapshots = getHabitTodayQuerySnapshots(
        queryClient,
        workspaceId,
      )

      queryClient.setQueryData<HabitRecord[]>(queryKey, (current = []) =>
        removeHabitRecord(current, habitId),
      )
      removeHabitFromTodayQueries(queryClient, workspaceId, habitId)
      await removeCachedHabitRecord(workspaceId, habitId)
      await removeCachedHabitFromTodayResponses(workspaceId, habitId)

      try {
        await requireHabitsApi(api).removeHabit(habitId)
        await invalidateHabits(queryClient, workspaceId)
      } catch (error) {
        if (shouldKeepOptimisticHabitMutation(error)) {
          await enqueueHabitOfflineMutation({
            actorUserId: session.actorUserId,
            habitId,
            type: 'habit.delete',
            workspaceId,
          })
          await refreshHabitOfflineStatus(queryClient, workspaceId)

          return
        }

        await restoreHabitRecords({
          habits: previousHabits,
          queryClient,
          queryKey,
          todaySnapshots: previousTodaySnapshots,
          workspaceId,
        })

        throw error
      }
    },
  })
}

export function useUpsertHabitEntry() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useHabitsApi()

  return useMutation({
    mutationFn: async ({
      date,
      habitId,
      input,
    }: HabitEntryMutationVariables) => {
      if (!session) {
        throw new Error('Planner session is required to update habit entries.')
      }

      const todayQueryKey = habitsTodayQueryKey(workspaceId, date)
      const previousToday =
        queryClient.getQueryData<HabitTodayResponse>(todayQueryKey) ??
        (await loadCachedHabitTodayOrFallback(workspaceId, date))
      const todayItem = previousToday.items.find(
        (item) => item.habit.id === habitId,
      )
      const habit =
        todayItem?.habit ??
        (await loadCachedHabitRecords(workspaceId)).find(
          (item) => item.id === habitId,
        )

      if (!habit) {
        throw new Error(`Habit "${habitId}" was not found.`)
      }

      const optimisticEntry = createOptimisticHabitEntry({
        actorUserId: session.actorUserId,
        date,
        habit,
        input,
        previousEntry: todayItem?.entry ?? null,
        workspaceId,
      })
      const optimisticToday = upsertEntryInTodayResponse(
        previousToday,
        habitId,
        optimisticEntry,
      )

      queryClient.setQueryData<HabitTodayResponse>(
        todayQueryKey,
        optimisticToday,
      )
      await replaceCachedHabitTodayResponse(workspaceId, date, optimisticToday)

      try {
        const entry = await requireHabitsApi(api).upsertEntry(
          habitId,
          date,
          input,
        )
        const syncedToday = upsertEntryInTodayResponse(
          optimisticToday,
          habitId,
          entry,
        )

        queryClient.setQueryData<HabitTodayResponse>(todayQueryKey, syncedToday)
        await replaceCachedHabitTodayResponse(workspaceId, date, syncedToday)
        await invalidateHabits(queryClient, workspaceId)

        return entry
      } catch (error) {
        if (shouldKeepOptimisticHabitMutation(error)) {
          await enqueueHabitOfflineMutation({
            actorUserId: session.actorUserId,
            date,
            habitId,
            input,
            type: 'habit.entry.upsert',
            workspaceId,
          })
          await refreshHabitOfflineStatus(queryClient, workspaceId)

          return optimisticEntry
        }

        await restoreHabitTodayResponse({
          date,
          queryClient,
          response: previousToday,
          workspaceId,
        })

        if (isHabitVersionConflict(error)) {
          await invalidateHabits(queryClient, workspaceId)
        }

        throw error
      }
    },
  })
}

export function useRemoveHabitEntry() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useHabitsApi()

  return useMutation({
    mutationFn: async ({ date, habitId, input }: HabitEntryRemoveVariables) => {
      if (!session) {
        throw new Error('Planner session is required to remove habit entries.')
      }

      const todayQueryKey = habitsTodayQueryKey(workspaceId, date)
      const previousToday =
        queryClient.getQueryData<HabitTodayResponse>(todayQueryKey) ??
        (await loadCachedHabitTodayOrFallback(workspaceId, date))
      const optimisticToday = removeEntryInTodayResponse(previousToday, habitId)

      queryClient.setQueryData<HabitTodayResponse>(
        todayQueryKey,
        optimisticToday,
      )
      await replaceCachedHabitTodayResponse(workspaceId, date, optimisticToday)

      try {
        await requireHabitsApi(api).removeEntry(habitId, date, input)
        await invalidateHabits(queryClient, workspaceId)
      } catch (error) {
        if (shouldKeepOptimisticHabitMutation(error)) {
          await enqueueHabitOfflineMutation({
            actorUserId: session.actorUserId,
            date,
            habitId,
            input,
            type: 'habit.entry.delete',
            workspaceId,
          })
          await refreshHabitOfflineStatus(queryClient, workspaceId)

          return
        }

        await restoreHabitTodayResponse({
          date,
          queryClient,
          response: previousToday,
          workspaceId,
        })

        if (isHabitVersionConflict(error)) {
          await invalidateHabits(queryClient, workspaceId)
        }

        throw error
      }
    },
  })
}

export function getHabitErrorMessage(error: unknown): string {
  if (error instanceof HabitsApiError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Не удалось сохранить привычку.'
}

function useHabitsApi(options: { enabled?: boolean } = {}) {
  const { apiConfig, isApiEnabled, session, workspaceId } =
    useSessionFeatureReadiness({
      enabled: options.enabled,
    })
  const api = useMemo(
    () => (apiConfig ? createHabitsApiClient(apiConfig) : null),
    [apiConfig],
  )

  return {
    api,
    isEnabled: isApiEnabled,
    session,
    workspaceId,
  }
}

function useOnlineHabitSync(input: {
  api: HabitsApiClient | null
  enabled: boolean
  queryClient: QueryClient
  retry?: (() => Promise<unknown>) | undefined
  workspaceId: string
}) {
  const { api, enabled, queryClient, retry, workspaceId } = input
  const handleOnline = useCallback(() => {
    if (!api) {
      return
    }

    if (retry) {
      return retry()
    }

    return drainQueuedHabitMutations({
      api,
      queryClient,
      workspaceId,
    })
  }, [api, queryClient, retry, workspaceId])

  useOfflineQueueDrain({
    drain: handleOnline,
    drainOnMount: false,
    enabled: enabled && Boolean(api),
  })
}

function requireHabitsApi(api: HabitsApiClient | null): HabitsApiClient {
  if (!api) {
    throw new HabitApiUnavailableError()
  }

  return api
}

async function drainQueuedHabitMutations(input: {
  api: HabitsApiClient
  queryClient: QueryClient
  workspaceId: string
}): Promise<HabitOfflineDrainResult> {
  return habitDrainCoordinator.drain(input.workspaceId, async () => {
    const result = await drainHabitOfflineQueue({
      api: input.api,
      onEntryDeleted: ({ date, habitId }) => {
        input.queryClient.setQueryData<HabitTodayResponse>(
          habitsTodayQueryKey(input.workspaceId, date),
          (current) =>
            current ? removeEntryInTodayResponse(current, habitId) : current,
        )
      },
      onEntrySynced: (entry) => {
        input.queryClient.setQueryData<HabitTodayResponse>(
          habitsTodayQueryKey(input.workspaceId, entry.date),
          (current) =>
            current
              ? upsertEntryInTodayResponse(current, entry.habitId, entry)
              : current,
        )
      },
      onHabitDeleted: (habitId) => {
        input.queryClient.setQueryData<HabitRecord[]>(
          habitsQueryKey(input.workspaceId),
          (current = []) => removeHabitRecord(current, habitId),
        )
        removeHabitFromTodayQueries(
          input.queryClient,
          input.workspaceId,
          habitId,
        )
      },
      onHabitSynced: (habit) => {
        input.queryClient.setQueryData<HabitRecord[]>(
          habitsQueryKey(input.workspaceId),
          (current = []) =>
            sortHabitRecords(replaceHabitRecord(current, habit)),
        )
        upsertHabitInTodayQueries(input.queryClient, input.workspaceId, habit)
      },
      workspaceId: input.workspaceId,
    })

    if (result.synced > 0 || result.conflicted > 0) {
      await invalidateHabits(input.queryClient, input.workspaceId)
    }

    await refreshHabitOfflineStatus(input.queryClient, input.workspaceId)

    return result
  })
}

async function invalidateHabits(queryClient: QueryClient, workspaceId: string) {
  await queryClient.invalidateQueries({ queryKey: ['habits', workspaceId] })
  await queryClient.invalidateQueries({ queryKey: ['planner', 'spheres'] })
}

async function refreshHabitOfflineStatus(
  queryClient: QueryClient,
  workspaceId: string,
): Promise<void> {
  queryClient.setQueryData(
    habitOfflineStatusQueryKey(workspaceId),
    await loadHabitOfflineStatus(workspaceId),
  )
}

async function loadHabitOfflineStatus(
  workspaceId: string,
): Promise<HabitOfflineStatus> {
  return {
    conflictedMutationCount:
      await countConflictedHabitOfflineMutations(workspaceId),
    queuedMutationCount: await countRetryableHabitOfflineMutations(workspaceId),
  }
}

async function loadCachedHabitTodayOrFallback(
  workspaceId: string,
  date: string,
): Promise<HabitTodayResponse> {
  const cachedResponse = await loadCachedHabitTodayResponse(workspaceId, date)

  if (cachedResponse) {
    return cachedResponse
  }

  return createFallbackTodayResponse(
    date,
    await loadCachedHabitRecords(workspaceId),
  )
}

async function loadCachedHabitStatsOrFallback(
  workspaceId: string,
  from: string,
  to: string,
): Promise<HabitStatsResponse> {
  const cachedResponse = await loadCachedHabitStatsResponse(
    workspaceId,
    from,
    to,
  )

  if (cachedResponse) {
    return cachedResponse
  }

  return createFallbackStatsResponse(
    from,
    to,
    await loadCachedHabitRecords(workspaceId),
  )
}

async function restoreHabitRecords(input: {
  habits: HabitRecord[]
  queryClient: QueryClient
  queryKey: ReturnType<typeof habitsQueryKey>
  todaySnapshots: HabitTodayQuerySnapshot[]
  workspaceId: string
}) {
  input.queryClient.setQueryData<HabitRecord[]>(input.queryKey, input.habits)
  await replaceCachedHabitRecords(input.workspaceId, input.habits)
  await restoreHabitTodaySnapshots(input.queryClient, input.todaySnapshots)
}

async function restoreHabitTodayResponse(input: {
  date: string
  queryClient: QueryClient
  response: HabitTodayResponse
  workspaceId: string
}) {
  input.queryClient.setQueryData(
    habitsTodayQueryKey(input.workspaceId, input.date),
    input.response,
  )
  await replaceCachedHabitTodayResponse(
    input.workspaceId,
    input.date,
    input.response,
  )
}

async function restoreHabitTodaySnapshots(
  queryClient: QueryClient,
  snapshots: HabitTodayQuerySnapshot[],
) {
  await Promise.all(
    snapshots.map(async ([queryKey, response]) => {
      queryClient.setQueryData(queryKey, response)

      if (response) {
        const workspaceId = getWorkspaceIdFromTodayQueryKey(queryKey)

        if (workspaceId) {
          await replaceCachedHabitTodayResponse(
            workspaceId,
            response.date,
            response,
          )
        }
      }
    }),
  )
}

function getHabitTodayQuerySnapshots(
  queryClient: QueryClient,
  workspaceId: string,
): HabitTodayQuerySnapshot[] {
  return queryClient.getQueriesData<HabitTodayResponse>({
    queryKey: ['habits', workspaceId, 'today'],
  })
}

function upsertHabitInTodayQueries(
  queryClient: QueryClient,
  workspaceId: string,
  habit: HabitRecord,
) {
  queryClient.setQueriesData<HabitTodayResponse>(
    { queryKey: ['habits', workspaceId, 'today'] },
    (current) =>
      current ? upsertHabitInTodayResponse(current, habit) : current,
  )
}

function removeHabitFromTodayQueries(
  queryClient: QueryClient,
  workspaceId: string,
  habitId: string,
) {
  queryClient.setQueriesData<HabitTodayResponse>(
    { queryKey: ['habits', workspaceId, 'today'] },
    (current) =>
      current ? removeHabitFromTodayResponse(current, habitId) : current,
  )
}

function getWorkspaceIdFromTodayQueryKey(queryKey: QueryKey): string | null {
  return queryKey[0] === 'habits' &&
    typeof queryKey[1] === 'string' &&
    queryKey[2] === 'today'
    ? queryKey[1]
    : null
}

function isHabitVersionConflict(error: unknown): boolean {
  return (
    error instanceof HabitsApiError &&
    (error.code === 'habit_version_conflict' ||
      error.code === 'habit_entry_version_conflict')
  )
}

function shouldKeepOptimisticHabitMutation(error: unknown): boolean {
  return (
    isHabitOfflineStorageAvailable() &&
    (error instanceof HabitApiUnavailableError ||
      isQueueableHabitMutationError(error))
  )
}

class HabitApiUnavailableError extends Error {
  constructor() {
    super('Habit session is not ready.')
    this.name = 'HabitApiUnavailableError'
  }
}
