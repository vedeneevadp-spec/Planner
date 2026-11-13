import type { GooglePlayTestingReview } from '@planner/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useSessionFeatureReadiness } from '@/features/session'
import { useBrowserOffline } from '@/shared/lib/offline-sync'

import { createGooglePlayTestingClient } from './api'

function useTestingAccess() {
  const access = useSessionFeatureReadiness()
  const offline = useBrowserOffline()
  const enabled =
    access.isApiEnabled && Boolean(access.apiConfig?.accessToken) && !offline
  function client() {
    if (
      !enabled ||
      !access.apiConfig ||
      !access.readiness.canWriteProtectedData
    ) {
      throw new Error('Подключитесь к интернету и войдите в аккаунт.')
    }
    return createGooglePlayTestingClient(access.apiConfig)
  }
  return { ...access, enabled, client }
}

export function useGooglePlayTesting() {
  const access = useTestingAccess()
  const queryClient = useQueryClient()
  const queryKey = ['google-play-testing', access.session?.actorUserId]
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => access.client().state(signal),
    enabled: access.enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
    gcTime: 0,
    retry: false,
  })
  const submit = useMutation({
    mutationFn: (email: string) => access.client().submit(email),
    onSuccess: (state) => queryClient.setQueryData(queryKey, state),
  })
  return { ...access, query, submit }
}

export function useGooglePlayTestingAdmin() {
  const access = useTestingAccess()
  const queryClient = useQueryClient()
  const isAdmin =
    access.session?.appRole === 'owner' || access.session?.appRole === 'admin'
  const query = useQuery({
    queryKey: ['google-play-testing-admin', access.session?.actorUserId],
    queryFn: ({ signal }) => access.client().admin(signal),
    enabled: access.enabled && isAdmin,
    gcTime: 0,
    retry: false,
    refetchInterval: 30_000,
  })
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['google-play-testing-admin'],
      }),
      queryClient.invalidateQueries({ queryKey: ['google-play-testing'] }),
    ])
  }
  const settings = useMutation({
    mutationFn: (isOpen: boolean) => access.client().setOpen(isOpen),
    onSuccess: refresh,
  })
  const review = useMutation({
    mutationFn: ({
      userId,
      ...input
    }: GooglePlayTestingReview & { userId: string }) =>
      access.client().review(userId, input),
    onSuccess: refresh,
    onError: refresh,
  })
  return { ...access, query, settings, review }
}
