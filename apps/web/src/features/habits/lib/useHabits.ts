import {
  generateUuidV7,
  type HabitEntryDeleteInput,
  type HabitEntryRecord,
  type HabitEntryUpsertInput,
  type HabitRecord,
  type HabitStats,
  type HabitStatsResponse,
  type HabitTodayItem,
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

import { usePlannerSession, useSessionAuth } from '@/features/session'
import { plannerApiConfig } from '@/shared/config/planner-api'
import { getDateKey } from '@/shared/lib/date'
import { useOnlineSync } from '@/shared/lib/offline-sync'

import {
  createHabitsApiClient,
  type HabitsApiClient,
  type HabitsApiClientConfig,
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

let habitDrainPromise: {
  promise: Promise<HabitOfflineDrainResult>
  workspaceId: string
} | null = null

function habitsQueryKey(workspaceId: string) {
  return ['habits', workspaceId] as const
}

function habitsTodayQueryKey(workspaceId: string, date: string) {
  return ['habits', workspaceId, 'today', date] as const
}

function habitStatsQueryKey(workspaceId: string, from: string, to: string) {
  return ['habits', workspaceId, 'stats', from, to] as const
}

function habitOfflineStatusQueryKey(workspaceId: string) {
  return ['habits', workspaceId, 'offline-status'] as const
}

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
  date = getDateKey(new Date()),
  options: { enabled?: boolean } = {},
) {
  const queryClient = useQueryClient()
  const { api, isEnabled, workspaceId } = useHabitsApi(options)
  const queryKey = useMemo(
    () => habitsTodayQueryKey(workspaceId, date),
    [date, workspaceId],
  )

  useEffect(() => {
    if (options.enabled === false || workspaceId === 'pending') {
      return
    }

    let isActive = true

    void loadCachedHabitTodayOrFallback(workspaceId, date).then((response) => {
      if (!isActive) {
        return
      }

      queryClient.setQueryData<HabitTodayResponse>(
        queryKey,
        (currentResponse) => currentResponse ?? response,
      )
    })

    return () => {
      isActive = false
    }
  }, [date, options.enabled, queryClient, queryKey, workspaceId])

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

        const response = await habitsApi.getToday(date, signal)

        await replaceCachedHabitTodayResponse(workspaceId, date, response)

        return response
      } catch (error) {
        if (isQueueableHabitMutationError(error)) {
          return loadCachedHabitTodayOrFallback(workspaceId, date)
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
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const isEnabled =
    options.enabled !== false &&
    Boolean(session) &&
    (!auth.isAuthEnabled || Boolean(auth.accessToken))
  const config = useMemo<HabitsApiClientConfig | null>(() => {
    if (!session || !isEnabled) {
      return null
    }

    return {
      ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
      actorUserId: session.actorUserId,
      apiBaseUrl: plannerApiConfig.apiBaseUrl,
      workspaceId: session.workspaceId,
    }
  }, [auth.accessToken, isEnabled, session])
  const api = useMemo(
    () => (config ? createHabitsApiClient(config) : null),
    [config],
  )

  return {
    api,
    isEnabled,
    session,
    workspaceId: session?.workspaceId ?? 'pending',
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

  useOnlineSync({
    enabled: enabled && Boolean(api),
    onOnline: handleOnline,
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
  if (habitDrainPromise) {
    if (habitDrainPromise.workspaceId === input.workspaceId) {
      return habitDrainPromise.promise
    }

    await habitDrainPromise.promise.catch(() => undefined)
  }

  const drainPromise = (async () => {
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
  })().finally(() => {
    if (habitDrainPromise?.promise === drainPromise) {
      habitDrainPromise = null
    }
  })
  habitDrainPromise = {
    promise: drainPromise,
    workspaceId: input.workspaceId,
  }

  return drainPromise
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

function createOptimisticHabit(
  input: NewHabitInput,
  context: {
    actorUserId: string
    sortOrder: number
    workspaceId: string
  },
): HabitRecord {
  const now = new Date().toISOString()

  return {
    color: input.color,
    createdAt: now,
    daysOfWeek: input.daysOfWeek,
    deletedAt: null,
    description: input.description,
    endDate: input.endDate,
    frequency: input.frequency,
    icon: input.icon,
    id: input.id ?? generateUuidV7(),
    isActive: true,
    reminderTime: input.reminderTime,
    sortOrder: input.sortOrder ?? context.sortOrder,
    sphereId: input.sphereId,
    startDate: input.startDate ?? getDateKey(new Date()),
    targetType: input.targetType,
    targetValue: input.targetValue,
    title: input.title,
    unit: input.unit,
    updatedAt: now,
    userId: context.actorUserId,
    version: 1,
    workspaceId: context.workspaceId,
  }
}

function applyHabitUpdate(
  habit: HabitRecord,
  input: HabitUpdateInput,
): HabitRecord {
  const now = new Date().toISOString()

  return {
    ...habit,
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(input.daysOfWeek !== undefined ? { daysOfWeek: input.daysOfWeek } : {}),
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
    ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
    ...(input.icon !== undefined ? { icon: input.icon } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.reminderTime !== undefined
      ? { reminderTime: input.reminderTime }
      : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.sphereId !== undefined ? { sphereId: input.sphereId } : {}),
    ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
    ...(input.targetType !== undefined ? { targetType: input.targetType } : {}),
    ...(input.targetValue !== undefined
      ? { targetValue: input.targetValue }
      : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
    updatedAt: now,
    version: habit.version + 1,
  }
}

function createOptimisticHabitEntry(input: {
  actorUserId: string
  date: string
  habit: HabitRecord
  input: HabitEntryUpsertInput
  previousEntry: HabitEntryRecord | null
  workspaceId: string
}): HabitEntryRecord {
  const now = new Date().toISOString()
  const status = input.input.status ?? 'done'

  return {
    createdAt: input.previousEntry?.createdAt ?? now,
    date: input.date,
    deletedAt: null,
    habitId: input.habit.id,
    id:
      input.previousEntry?.id ??
      `optimistic-habit-entry-${input.habit.id}-${input.date}`,
    note: input.input.note ?? input.previousEntry?.note ?? '',
    status,
    updatedAt: now,
    userId: input.actorUserId,
    value:
      input.input.value ??
      (status === 'skipped' ? 0 : getDefaultHabitEntryValue(input.habit)),
    version: (input.previousEntry?.version ?? 0) + 1,
    workspaceId: input.workspaceId,
  }
}

function createFallbackTodayResponse(
  date: string,
  habits: HabitRecord[],
): HabitTodayResponse {
  return {
    date,
    items: sortHabitRecords(habits)
      .filter((habit) => isHabitScheduledOnDate(habit, date))
      .map((habit) => createHabitTodayItem({ date, entry: null, habit })),
  }
}

function createFallbackStatsResponse(
  from: string,
  to: string,
  habits: HabitRecord[],
): HabitStatsResponse {
  const sortedHabits = sortHabitRecords(habits)

  return {
    from,
    habits: sortedHabits,
    stats: sortedHabits.map((habit) => createEmptyHabitStats(habit.id)),
    to,
  }
}

function createHabitTodayItem(input: {
  date: string
  entry: HabitEntryRecord | null
  habit: HabitRecord
}): HabitTodayItem {
  return {
    entry: input.entry,
    habit: input.habit,
    isDueToday: true,
    progressPercent: getEntryProgressPercent(input.habit, input.entry),
    stats: createEmptyHabitStats(input.habit.id),
  }
}

function createEmptyHabitStats(habitId: string): HabitStats {
  return {
    bestStreak: 0,
    completedCount: 0,
    completionRate: 0,
    currentStreak: 0,
    habitId,
    lastCompletedDate: null,
    missedCount: 0,
    monthCompleted: 0,
    monthScheduled: 0,
    scheduledCount: 0,
    skippedCount: 0,
    weekCompleted: 0,
    weekScheduled: 0,
  }
}

function upsertHabitInTodayResponse(
  response: HabitTodayResponse,
  habit: HabitRecord,
): HabitTodayResponse {
  const item = response.items.find((entry) => entry.habit.id === habit.id)

  if (!isHabitScheduledOnDate(habit, response.date)) {
    return removeHabitFromTodayResponse(response, habit.id)
  }

  if (!item) {
    return {
      ...response,
      items: [
        ...response.items,
        createHabitTodayItem({
          date: response.date,
          entry: null,
          habit,
        }),
      ],
    }
  }

  return {
    ...response,
    items: response.items.map((entry) =>
      entry.habit.id === habit.id
        ? {
            ...entry,
            habit,
            progressPercent: getEntryProgressPercent(habit, entry.entry),
          }
        : entry,
    ),
  }
}

function removeHabitFromTodayResponse(
  response: HabitTodayResponse,
  habitId: string,
): HabitTodayResponse {
  return {
    ...response,
    items: response.items.filter((item) => item.habit.id !== habitId),
  }
}

function upsertEntryInTodayResponse(
  response: HabitTodayResponse,
  habitId: string,
  entry: HabitEntryRecord,
): HabitTodayResponse {
  return {
    ...response,
    items: response.items.map((item) =>
      item.habit.id === habitId
        ? {
            ...item,
            entry,
            progressPercent: getEntryProgressPercent(item.habit, entry),
          }
        : item,
    ),
  }
}

function removeEntryInTodayResponse(
  response: HabitTodayResponse,
  habitId: string,
): HabitTodayResponse {
  return {
    ...response,
    items: response.items.map((item) =>
      item.habit.id === habitId
        ? {
            ...item,
            entry: null,
            progressPercent: 0,
          }
        : item,
    ),
  }
}

function replaceHabitRecord(
  habits: HabitRecord[],
  nextHabit: HabitRecord,
): HabitRecord[] {
  const existingIndex = habits.findIndex((habit) => habit.id === nextHabit.id)

  if (existingIndex === -1) {
    return [...habits, nextHabit]
  }

  return habits.map((habit) => (habit.id === nextHabit.id ? nextHabit : habit))
}

function removeHabitRecord(
  habits: HabitRecord[],
  habitId: string,
): HabitRecord[] {
  return habits.filter((habit) => habit.id !== habitId)
}

function sortHabitRecords(habits: HabitRecord[]): HabitRecord[] {
  return [...habits].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder
    }

    return left.title.localeCompare(right.title, 'ru')
  })
}

function getEntryProgressPercent(
  habit: Pick<HabitRecord, 'targetValue'>,
  entry: Pick<HabitEntryRecord, 'status' | 'value'> | null,
): number {
  if (!entry || entry.status === 'skipped') {
    return 0
  }

  return Math.min(100, Math.round((entry.value / habit.targetValue) * 100))
}

function getDefaultHabitEntryValue(
  habit: Pick<HabitRecord, 'targetType' | 'targetValue'>,
): number {
  return habit.targetType === 'check' ? habit.targetValue : 0
}

function isHabitScheduledOnDate(habit: HabitRecord, dateKey: string): boolean {
  if (!habit.isActive || dateKey < habit.startDate) {
    return false
  }

  if (habit.endDate && dateKey > habit.endDate) {
    return false
  }

  return habit.daysOfWeek.includes(getIsoWeekday(dateKey))
}

function getIsoWeekday(dateKey: string): number {
  const day = new Date(`${dateKey}T00:00:00`).getDay()

  return day === 0 ? 7 : day
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
