import {
  type CleaningListResponse,
  type CleaningTaskActionInput,
  type CleaningTaskUpdateInput,
  type CleaningTodayResponse,
  type CleaningZoneUpdateInput,
  type NewCleaningTaskInput,
  type NewCleaningZoneInput,
} from '@planner/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  usePlannerTimeZone,
  useSessionFeatureReadiness,
} from '@/features/session'
import { getTodayDate } from '@/shared/time/time.service'

import {
  type CleaningApiClient,
  CleaningApiError,
  createCleaningApiClient,
} from './cleaning-api'

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

function cleaningQueryKey(workspaceId: string) {
  return ['cleaning', workspaceId] as const
}

function cleaningTodayQueryKey(workspaceId: string, date: string) {
  return ['cleaning', workspaceId, 'today', date] as const
}

export function useCleaningPlan(options: { enabled?: boolean } = {}) {
  const { api, isEnabled, workspaceId } = useCleaningApi(options)
  const queryKey = useMemo(() => cleaningQueryKey(workspaceId), [workspaceId])

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) => requireCleaningApi(api).listCleaning(signal),
    queryKey,
    staleTime: 30_000,
  })
}

export function useCleaningToday(
  date?: string,
  options: { enabled?: boolean } = {},
) {
  const { api, isEnabled, workspaceId } = useCleaningApi(options)
  const plannerTimeZone = usePlannerTimeZone()
  const resolvedDate = date ?? getTodayDate(plannerTimeZone)
  const queryKey = useMemo(
    () => cleaningTodayQueryKey(workspaceId, resolvedDate),
    [resolvedDate, workspaceId],
  )

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) =>
      requireCleaningApi(api).getToday(resolvedDate, signal),
    queryKey,
    staleTime: 20_000,
  })
}

export function useCleaningSummary(date?: string) {
  const query = useCleaningToday(date)

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
  const { api, session, workspaceId } = useCleaningApi()

  return useMutation({
    mutationFn: async (input: NewCleaningZoneInput) => {
      if (!session) {
        throw new Error('Planner session is required to create cleaning zones.')
      }

      const zone = await requireCleaningApi(api).createZone(input)
      await invalidateCleaning(queryClient, workspaceId)

      return zone
    },
  })
}

export function useUpdateCleaningZone() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useCleaningApi()

  return useMutation({
    mutationFn: async ({ input, zoneId }: CleaningZoneUpdateVariables) => {
      if (!session) {
        throw new Error('Planner session is required to update cleaning zones.')
      }

      const zone = await requireCleaningApi(api).updateZone(zoneId, input)
      await invalidateCleaning(queryClient, workspaceId)

      return zone
    },
  })
}

export function useRemoveCleaningZone() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useCleaningApi()

  return useMutation({
    mutationFn: async (zoneId: string) => {
      if (!session) {
        throw new Error('Planner session is required to remove cleaning zones.')
      }

      await requireCleaningApi(api).removeZone(zoneId)
      await invalidateCleaning(queryClient, workspaceId)
    },
  })
}

export function useCreateCleaningTask() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useCleaningApi()

  return useMutation({
    mutationFn: async (input: NewCleaningTaskInput) => {
      if (!session) {
        throw new Error('Planner session is required to create cleaning tasks.')
      }

      const task = await requireCleaningApi(api).createTask(input)
      await invalidateCleaning(queryClient, workspaceId)

      return task
    },
  })
}

export function useUpdateCleaningTask() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useCleaningApi()

  return useMutation({
    mutationFn: async ({ input, taskId }: CleaningTaskUpdateVariables) => {
      if (!session) {
        throw new Error('Planner session is required to update cleaning tasks.')
      }

      const task = await requireCleaningApi(api).updateTask(taskId, input)
      await invalidateCleaning(queryClient, workspaceId)

      return task
    },
  })
}

export function useRemoveCleaningTask() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useCleaningApi()

  return useMutation({
    mutationFn: async (taskId: string) => {
      if (!session) {
        throw new Error('Planner session is required to remove cleaning tasks.')
      }

      await requireCleaningApi(api).removeTask(taskId)
      await invalidateCleaning(queryClient, workspaceId)
    },
  })
}

export function useCompleteCleaningTask() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useCleaningApi()

  return useMutation({
    mutationFn: async ({ input, taskId }: CleaningTaskActionVariables) => {
      if (!session) {
        throw new Error(
          'Planner session is required to complete cleaning tasks.',
        )
      }

      const result = await requireCleaningApi(api).completeTask(taskId, input)
      await invalidateCleaning(queryClient, workspaceId)

      return result
    },
  })
}

export function usePostponeCleaningTask() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useCleaningApi()

  return useMutation({
    mutationFn: async ({ input, taskId }: CleaningTaskActionVariables) => {
      if (!session) {
        throw new Error(
          'Planner session is required to postpone cleaning tasks.',
        )
      }

      const result = await requireCleaningApi(api).postponeTask(taskId, input)
      await invalidateCleaning(queryClient, workspaceId)

      return result
    },
  })
}

export function useSkipCleaningTask() {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useCleaningApi()

  return useMutation({
    mutationFn: async ({ input, taskId }: CleaningTaskActionVariables) => {
      if (!session) {
        throw new Error('Planner session is required to skip cleaning tasks.')
      }

      const result = await requireCleaningApi(api).skipTask(taskId, input)
      await invalidateCleaning(queryClient, workspaceId)

      return result
    },
  })
}

export function getCleaningErrorMessage(error: unknown): string {
  if (error instanceof CleaningApiError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Не удалось сохранить уборку.'
}

function useCleaningApi(options: { enabled?: boolean } = {}) {
  const { apiConfig, isApiEnabled, session, workspaceId } =
    useSessionFeatureReadiness({
      enabled: options.enabled,
    })
  const api = useMemo(
    () => (apiConfig ? createCleaningApiClient(apiConfig) : null),
    [apiConfig],
  )

  return {
    api,
    isEnabled: isApiEnabled,
    session,
    workspaceId,
  }
}

function requireCleaningApi(api: CleaningApiClient | null): CleaningApiClient {
  if (!api) {
    throw new Error('Cleaning API is not ready.')
  }

  return api
}

async function invalidateCleaning(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: cleaningQueryKey(workspaceId) }),
    queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        query.queryKey[0] === 'cleaning' &&
        query.queryKey[1] === workspaceId,
    }),
  ])
}

export type { CleaningListResponse, CleaningTodayResponse }
