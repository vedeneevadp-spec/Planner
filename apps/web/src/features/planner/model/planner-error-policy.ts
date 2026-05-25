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

export function getErrorDebugDetails(
  label: string,
  error: unknown,
): string | null {
  if (!error) {
    return null
  }

  const lines = [`[${label}]`]

  if (error instanceof Error) {
    lines.push(`name=${error.name}`, `message=${error.message}`)

    const errorRecord = error as unknown as Record<string, unknown>
    const status = errorRecord.status
    const code = errorRecord.code
    const details = errorRecord.details

    if (typeof status === 'number') {
      lines.push(`status=${status}`)
    }

    if (typeof code === 'string') {
      lines.push(`code=${code}`)
    }

    if (details !== undefined) {
      lines.push(`details=${stringifyDebugValue(details)}`)
    }

    if (error.stack) {
      lines.push(`stack=${error.stack}`)
    }

    return lines.join('\n')
  }

  lines.push(`value=${stringifyDebugValue(error)}`)

  return lines.join('\n')
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

function stringifyDebugValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
