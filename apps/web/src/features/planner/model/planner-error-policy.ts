import { isUnauthorizedSessionApiError } from '@/features/session'
import { isBrowserRetryableOfflineError } from '@/shared/lib/offline-sync'

import { isPlannerOfflineStorageAvailable } from '../lib/offline-planner-store'
import { isQueueablePlannerMutationError } from '../lib/offline-planner-sync'
import {
  isUnauthorizedPlannerApiError,
  type PlannerApiClient,
  PlannerApiError,
} from '../lib/planner-api'

export class PlannerApiUnavailableError extends Error {
  constructor() {
    super('Planner session is not ready.')
    this.name = 'PlannerApiUnavailableError'
  }
}

export function getErrorMessage(error: unknown): string {
  if (
    isUnauthorizedPlannerApiError(error) ||
    isUnauthorizedSessionApiError(error)
  ) {
    return 'Не удалось подтвердить серверную сессию. Можно продолжать локально, изменения синхронизируются после восстановления входа.'
  }

  if (isRetryablePlannerConnectionError(error)) {
    return 'Нет соединения. Показываем сохраненные данные и синхронизируем автоматически.'
  }

  if (error instanceof PlannerApiError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Не удалось синхронизировать данные.'
}

export function getPlannerQueryErrorMessage(
  error: unknown,
  options: { hasCachedRecords: boolean },
): string | null {
  if (!error) {
    return null
  }

  if (options.hasCachedRecords && isRetryablePlannerConnectionError(error)) {
    return null
  }

  return getErrorMessage(error)
}

export function isRetryablePlannerConnectionError(error: unknown): boolean {
  if (error instanceof PlannerApiError) {
    return false
  }

  return isBrowserRetryableOfflineError(error)
}

export function shouldKeepOptimisticMutation(error: unknown): boolean {
  return (
    isPlannerOfflineStorageAvailable() &&
    (error instanceof PlannerApiUnavailableError ||
      isUnauthorizedPlannerApiError(error) ||
      isUnauthorizedSessionApiError(error) ||
      isQueueablePlannerMutationError(error))
  )
}

export function requirePlannerApi(
  plannerApi: PlannerApiClient | null,
): PlannerApiClient {
  if (!plannerApi) {
    throw new PlannerApiUnavailableError()
  }

  return plannerApi
}
