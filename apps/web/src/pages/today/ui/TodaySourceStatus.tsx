import { useState } from 'react'

import type { SessionReadiness } from '@/features/session'
import {
  isBrowserRetryableOfflineError,
  useBrowserOffline,
} from '@/shared/lib/offline-sync'
import { PageStatusBanner } from '@/shared/ui/PageState'

import styles from './TodayPage.module.css'

interface TodaySourceQuery {
  data: unknown
  error: unknown
  readError?: unknown
  isFetching: boolean
  isPending: boolean
  isCacheHydrating?: boolean
  isCacheLoading?: boolean
  isShowingCachedData?: boolean
  lastSuccessfulSyncAt?: string | null
  readiness?: SessionReadiness
  refetch: () => Promise<unknown>
  retrySession?: () => Promise<unknown>
}

export function TodaySourceStatus({
  emptyMessage,
  isEmpty,
  label,
  query,
}: {
  emptyMessage: string
  isEmpty: boolean
  label: string
  query: TodaySourceQuery
}) {
  const isBrowserOffline = useBrowserOffline()
  const [isRetrying, setIsRetrying] = useState(false)
  const [retryError, setRetryError] = useState<unknown>(null)
  const hasData = query.data !== undefined
  const error = query.error ?? query.readError ?? retryError
  const isOffline =
    isBrowserOffline ||
    isBrowserRetryableOfflineError(error) ||
    query.readiness?.status === 'offlineWithCache'
  const isRestoring =
    query.readiness?.reason === 'auth_restoring' ||
    query.readiness?.reason === 'planner_pending'
  const hasAccessIssue =
    query.readiness !== undefined && !query.readiness.canUseProtectedApi
  const isLoading =
    !hasData &&
    (query.isCacheHydrating ||
      query.isCacheLoading ||
      (!isOffline && !error && (query.isPending || isRestoring)))

  async function retry() {
    setIsRetrying(true)
    setRetryError(null)
    try {
      if (hasAccessIssue && query.retrySession) {
        await query.retrySession()
      } else {
        await query.refetch()
      }
    } catch (nextError) {
      setRetryError(nextError)
    } finally {
      setIsRetrying(false)
    }
  }

  if (isLoading) {
    return (
      <div aria-busy="true">
        <PageStatusBanner
          description=""
          kind="info"
          title={`${label}: загружаем данные`}
        />
      </div>
    )
  }

  if (
    !hasData ||
    error ||
    isOffline ||
    hasAccessIssue ||
    query.isShowingCachedData
  ) {
    return (
      <PageStatusBanner
        action={{
          disabled: isRetrying || query.isFetching,
          label: `Повторить: ${label}`,
          onClick: () => {
            void retry()
          },
        }}
        description={
          hasData
            ? 'Сохранённые данные остаются доступны. После обновления список может измениться.'
            : 'Этот раздел пока не удалось проверить. Остальные задачи остаются доступны.'
        }
        kind={isOffline ? 'offline' : error || !hasData ? 'error' : 'info'}
        lastSyncedAt={query.lastSuccessfulSyncAt}
        title={
          hasData
            ? `${label}: данные могут быть устаревшими`
            : `${label}: не удалось загрузить данные`
        }
      />
    )
  }

  return isEmpty ? (
    <p className={styles.sourceEmpty} role="status">
      {emptyMessage}
    </p>
  ) : null
}
