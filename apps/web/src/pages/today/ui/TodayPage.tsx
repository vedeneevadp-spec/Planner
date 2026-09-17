import { useState } from 'react'
import { useSearchParams } from 'react-router'

import { usePlanner } from '@/features/planner'
import {
  type SessionReadiness,
  usePlannerSession,
  usePlannerTimeZone,
  useSessionAuth,
} from '@/features/session'
import { useBrowserOffline } from '@/shared/lib/offline-sync'
import { getTodayDate } from '@/shared/time/time.service'
import { PageStateView } from '@/shared/ui/PageState'

import { PersonalTodayPage } from './PersonalTodayPage'
import { SharedTodayPage } from './SharedTodayPage'
import { TodayPageStateLayout } from './TodayPageLayout'
import { TodayStatusNotice } from './TodayStatusNotice'

type TodayBlockingState = 'error' | 'loading' | 'offline' | null

export function TodayPage() {
  const [isRetrying, setIsRetrying] = useState(false)
  const [searchParams] = useSearchParams()
  const sessionQuery = usePlannerSession()
  const { isRecoveringSession } = useSessionAuth()
  const session = sessionQuery.data
  const plannerTimeZone = usePlannerTimeZone()
  const todayKey = getTodayDate(plannerTimeZone)
  const {
    errorMessage,
    hasTaskReadError,
    hasTaskRecords,
    isLoading,
    isTaskCacheHydrating,
    isTaskOffline,
    isTaskReadFetching,
    readiness,
    refresh,
    taskReadModelCoverage,
    taskLastSuccessfulSyncAt,
  } = usePlanner()
  const isBrowserOffline = useBrowserOffline()
  const isOffline = isBrowserOffline || isTaskOffline
  const isRestoring =
    readiness.status === 'restoringWithCache' ||
    readiness.reason === 'auth_restoring' ||
    readiness.reason === 'planner_pending'
  const hasAccessIssue = isTodayAccessUnavailable(readiness)
  const isReadPending =
    isLoading ||
    isTaskCacheHydrating ||
    isRestoring ||
    isTaskReadFetching ||
    sessionQuery.isFetching ||
    isRecoveringSession ||
    isRetrying
  const blockingState = resolveTodayBlockingState({
    hasTaskRecords,
    isCacheHydrating: isTaskCacheHydrating,
    isLoading: isReadPending,
    isOffline: isBrowserOffline,
    readiness,
  })
  const dailyLoadCoverage = taskReadModelCoverage?.sources.dailyLoad
  const hasCompleteTaskSnapshot =
    taskReadModelCoverage &&
    !taskReadModelCoverage.sources.active.truncated &&
    !taskReadModelCoverage.sources.history.truncated
  const hasCompleteDailyLoad = dailyLoadCoverage
    ? dailyLoadCoverage.date === todayKey &&
      dailyLoadCoverage.timeZone === plannerTimeZone &&
      (!dailyLoadCoverage.truncated || hasCompleteTaskSnapshot)
    : hasCompleteTaskSnapshot
  const isTaskDataComplete = Boolean(
    hasTaskRecords &&
    !isLoading &&
    !isTaskCacheHydrating &&
    !hasTaskReadError &&
    !isOffline &&
    !isRestoring &&
    !hasAccessIssue &&
    hasCompleteDailyLoad,
  )
  const openTaskId = normalizeOpenTaskId(searchParams.get('taskId'))

  function retryToday() {
    setIsRetrying(true)
    void Promise.allSettled([
      sessionQuery.refetch(),
      refresh({ retryDeniedAuth: true }),
    ]).finally(() => setIsRetrying(false))
  }

  if (blockingState) {
    return (
      <TodayPageStateLayout>
        {blockingState === 'loading' ? (
          <PageStateView
            kind="loading"
            skeletonVariant="cards"
            title={
              isBrowserOffline && isTaskCacheHydrating
                ? 'Проверяем сохранённый план на сегодня'
                : 'Загружаем план на сегодня'
            }
          />
        ) : blockingState === 'offline' ? (
          <PageStateView
            action={{ label: 'Повторить', onClick: retryToday }}
            description="На этом устройстве ещё нет сохранённого плана. Подключитесь к сети и попробуйте снова."
            kind="offline"
            lastSyncedAt={taskLastSuccessfulSyncAt}
            showUnknownLastSync
            title="План на сегодня недоступен без подключения"
          />
        ) : (
          <PageStateView
            action={{ label: 'Повторить', onClick: retryToday }}
            description={
              hasAccessIssue
                ? 'Восстановите сессию и повторите загрузку.'
                : errorMessage || 'Попробуйте загрузить план ещё раз.'
            }
            kind="error"
            title={
              hasAccessIssue
                ? 'Нужно восстановить доступ к плану'
                : 'Не удалось загрузить план на сегодня'
            }
          />
        )}
      </TodayPageStateLayout>
    )
  }

  const status = isBrowserOffline ? (
    <TodayStatusNotice
      action={{ disabled: isRetrying, label: 'Обновить', onClick: retryToday }}
      message="Нет подключения · показываем сохранённые данные"
    />
  ) : isReadPending ? (
    false
  ) : hasAccessIssue ? (
    <TodayStatusNotice
      action={{
        disabled: isRetrying,
        label: 'Обновить доступ',
        onClick: retryToday,
      }}
      message="Нужно восстановить доступ"
    />
  ) : hasTaskReadError || isTaskOffline ? (
    <TodayStatusNotice
      action={{ disabled: isRetrying, label: 'Обновить', onClick: retryToday }}
      message="Не удалось обновить задачи · показываем сохранённые данные"
    />
  ) : undefined
  return session?.workspace.kind === 'shared' ? (
    <SharedTodayPage openTaskId={openTaskId} status={status} />
  ) : (
    <PersonalTodayPage
      isTaskDataComplete={isTaskDataComplete}
      openTaskId={openTaskId}
      status={status}
    />
  )
}

function normalizeOpenTaskId(value: string | null): string | null {
  const normalizedValue = value?.trim() ?? ''

  return /^[A-Za-z0-9_-]{1,128}$/.test(normalizedValue) ? normalizedValue : null
}

function resolveTodayBlockingState(input: {
  hasTaskRecords: boolean
  isCacheHydrating: boolean
  isLoading: boolean
  isOffline: boolean
  readiness: SessionReadiness
}): TodayBlockingState {
  if (input.hasTaskRecords) {
    return null
  }

  if (input.isCacheHydrating) {
    return 'loading'
  }

  if (input.isOffline) {
    return 'offline'
  }

  if (
    input.isLoading ||
    input.readiness.reason === 'auth_restoring' ||
    input.readiness.reason === 'planner_pending'
  ) {
    return 'loading'
  }

  if (isTodayAccessUnavailable(input.readiness)) {
    return 'error'
  }

  return 'error'
}

function isTodayAccessUnavailable(
  readiness: Pick<SessionReadiness, 'reason'>,
): boolean {
  return (
    readiness.reason === 'auth_deferred' ||
    readiness.reason === 'no_session' ||
    readiness.reason === 'unauthorized'
  )
}
