import { useState } from 'react'

import type { SessionReadiness } from '@/features/session'
import { useBrowserOffline } from '@/shared/lib/offline-sync'

import { TodayStatusNotice } from './TodayStatusNotice'

interface TodaySourceQuery {
  data: unknown
  error: unknown
  readError?: unknown
  isFetching: boolean
  isPending: boolean
  isCacheHydrating?: boolean
  isCacheLoading?: boolean
  isShowingCachedData?: boolean
  readiness?: SessionReadiness
  refetch: () => Promise<unknown>
  retrySession?: () => Promise<unknown>
}

export interface TodayStatusSource {
  label: string
  query: TodaySourceQuery
}

export function TodaySourceStatus({
  sources,
}: {
  sources: TodayStatusSource[]
}) {
  const isBrowserOffline = useBrowserOffline()
  const [isRetrying, setIsRetrying] = useState(false)
  const unavailableSources = sources.filter(({ query }) =>
    isSourceUnavailable(query, isBrowserOffline),
  )

  async function retry() {
    setIsRetrying(true)
    const retries = new Set(
      unavailableSources.map(({ query }) =>
        query.readiness &&
        !query.readiness.canUseProtectedApi &&
        query.retrySession
          ? query.retrySession
          : query.refetch,
      ),
    )
    await Promise.allSettled([...retries].map(async (refetch) => refetch()))
    setIsRetrying(false)
  }

  const unavailableLabels = Array.from(
    new Set(unavailableSources.map(({ label }) => label)),
  )

  if (isRetrying && !isBrowserOffline) {
    return null
  }

  if (unavailableLabels.length > 0) {
    return (
      <TodayStatusNotice
        action={{
          disabled:
            isRetrying ||
            unavailableSources.some(({ query }) => query.isFetching),
          label: 'Повторить',
          onClick: () => {
            void retry()
          },
        }}
        message={`Не обновились: ${unavailableLabels.join(', ')}.`}
      />
    )
  }

  return null
}

function isSourceUnavailable(
  query: TodaySourceQuery,
  isBrowserOffline: boolean,
): boolean {
  if (isBrowserOffline) {
    return true
  }

  const isRestoring =
    query.readiness?.reason === 'auth_restoring' ||
    query.readiness?.reason === 'planner_pending'
  if (
    query.isFetching ||
    query.isPending ||
    query.isCacheHydrating ||
    query.isCacheLoading ||
    isRestoring
  ) {
    return false
  }

  return Boolean(query.error ?? query.readError)
}
