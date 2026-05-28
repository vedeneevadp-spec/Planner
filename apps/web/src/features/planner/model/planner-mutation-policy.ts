import { isUnauthorizedSessionApiError } from '@/features/session'

import {
  isUnauthorizedPlannerApiError,
  PlannerApiError,
} from '../lib/planner-api'

interface PlannerVersionConflict {
  message: string
  target: 'lifeSphere' | 'task'
}

export function getQueuedPlannerMutationMessage(error: unknown): string {
  if (
    isUnauthorizedSessionApiError(error) ||
    isUnauthorizedPlannerApiError(error)
  ) {
    return 'Не удалось подтвердить серверную сессию. Изменение сохранено локально и синхронизируется после восстановления входа.'
  }

  return 'Нет соединения. Изменение сохранено локально и синхронизируется автоматически.'
}

export function getPlannerVersionConflict(
  error: unknown,
): PlannerVersionConflict | null {
  if (!(error instanceof PlannerApiError)) {
    return null
  }

  if (error.code === 'task_version_conflict') {
    return {
      message:
        'Задача уже изменилась на сервере. Обновили данные, повторите действие.',
      target: 'task',
    }
  }

  if (error.code === 'life_sphere_version_conflict') {
    return {
      message:
        'Сфера уже изменилась на сервере. Обновили данные, повторите действие.',
      target: 'lifeSphere',
    }
  }

  return null
}
