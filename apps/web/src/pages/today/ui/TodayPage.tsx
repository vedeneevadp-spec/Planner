import { usePlanner } from '@/features/planner'
import { type SessionReadiness, usePlannerSession } from '@/features/session'
import { useBrowserOffline } from '@/shared/lib/offline-sync'
import { PageStateView, PageStatusBanner } from '@/shared/ui/PageState'

import { PersonalTodayPage } from './PersonalTodayPage'
import { SharedTodayPage } from './SharedTodayPage'
import { TodayPageStateLayout } from './TodayPageLayout'

type TodayBlockingState = 'error' | 'loading' | 'offline' | null

export function TodayPage() {
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const {
    errorMessage,
    hasTaskReadError,
    hasTaskRecords,
    isLoading,
    isTaskCacheHydrating,
    isTaskOffline,
    readiness,
    refresh,
    taskReadModelCoverage,
    taskLastSuccessfulSyncAt,
  } = usePlanner()
  const isBrowserOffline = useBrowserOffline()
  const isOffline =
    isBrowserOffline || isTaskOffline || readiness.status === 'offlineWithCache'
  const blockingState = resolveTodayBlockingState({
    hasTaskRecords,
    isCacheHydrating: isTaskCacheHydrating,
    isLoading,
    isOffline,
    readiness,
  })
  const isRestoring =
    readiness.status === 'restoringWithCache' ||
    readiness.reason === 'auth_restoring' ||
    readiness.reason === 'planner_pending'
  const hasAccessIssue = isTodayAccessUnavailable(readiness)

  function retryToday() {
    void Promise.allSettled([sessionQuery.refetch(), refresh()])
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

  const status = hasAccessIssue ? (
    <PageStatusBanner
      action={{ label: 'Обновить доступ', onClick: retryToday }}
      description="Показываем сохранённый план. Для синхронизации восстановите сессию."
      kind="error"
      lastSyncedAt={taskLastSuccessfulSyncAt}
      showUnknownLastSync
      title="Нужно восстановить доступ"
    />
  ) : isOffline ? (
    <PageStatusBanner
      action={{ label: 'Обновить', onClick: retryToday }}
      kind="offline"
      lastSyncedAt={taskLastSuccessfulSyncAt}
      showUnknownLastSync
    />
  ) : isRestoring ? (
    <PageStatusBanner
      description="Показываем сохранённый план и восстанавливаем синхронизацию."
      kind="info"
      lastSyncedAt={taskLastSuccessfulSyncAt}
      showUnknownLastSync
      title="Восстанавливаем данные"
    />
  ) : hasTaskReadError ? (
    <PageStatusBanner
      action={{ label: 'Обновить', onClick: retryToday }}
      description={errorMessage || undefined}
      kind="error"
      lastSyncedAt={taskLastSuccessfulSyncAt}
      showUnknownLastSync
    />
  ) : taskReadModelCoverage &&
    (taskReadModelCoverage.sources.active.truncated ||
      taskReadModelCoverage.sources.range.truncated) ? (
    <PageStatusBanner
      description={getTaskSnapshotCoverageDescription()}
      kind="info"
      title="Большой архив загружен частично"
    />
  ) : undefined

  return session?.workspace.kind === 'shared' ? (
    <SharedTodayPage status={status} />
  ) : (
    <PersonalTodayPage status={status} />
  )
}

function getTaskSnapshotCoverageDescription(): string {
  return 'Показываем ограниченный snapshot. Все активные задачи сверх лимита и продолжение выбранного диапазона доступны через постраничную загрузку.'
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

  if (
    input.isCacheHydrating ||
    input.isLoading ||
    input.readiness.reason === 'auth_restoring' ||
    input.readiness.reason === 'planner_pending'
  ) {
    return 'loading'
  }

  if (isTodayAccessUnavailable(input.readiness)) {
    return 'error'
  }

  if (input.isOffline) {
    return 'offline'
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
