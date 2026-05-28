import { describe, expect, it } from 'vitest'

import { SessionApiError } from '@/features/session'

import { PlannerApiError } from '../lib/planner-api'
import {
  getPlannerVersionConflict,
  getQueuedPlannerMutationMessage,
} from './planner-mutation-policy'

describe('planner mutation policy', () => {
  it('uses a session recovery message for unauthorized queued mutations', () => {
    expect(
      getQueuedPlannerMutationMessage(
        new PlannerApiError('Unauthorized.', {
          code: 'unauthorized',
          status: 401,
        }),
      ),
    ).toBe(
      'Не удалось подтвердить серверную сессию. Изменение сохранено локально и синхронизируется после восстановления входа.',
    )
    expect(
      getQueuedPlannerMutationMessage(
        new SessionApiError('Unauthorized.', {
          code: 'unauthorized',
          status: 401,
        }),
      ),
    ).toBe(
      'Не удалось подтвердить серверную сессию. Изменение сохранено локально и синхронизируется после восстановления входа.',
    )
  })

  it('uses a generic offline message for retryable queued mutations', () => {
    expect(
      getQueuedPlannerMutationMessage(new TypeError('Failed to fetch')),
    ).toBe(
      'Нет соединения. Изменение сохранено локально и синхронизируется автоматически.',
    )
  })

  it('classifies task and sphere version conflicts', () => {
    expect(
      getPlannerVersionConflict(
        new PlannerApiError('Conflict.', {
          code: 'task_version_conflict',
          status: 409,
        }),
      ),
    ).toEqual({
      message:
        'Задача уже изменилась на сервере. Обновили данные, повторите действие.',
      target: 'task',
    })
    expect(
      getPlannerVersionConflict(
        new PlannerApiError('Conflict.', {
          code: 'life_sphere_version_conflict',
          status: 409,
        }),
      ),
    ).toEqual({
      message:
        'Сфера уже изменилась на сервере. Обновили данные, повторите действие.',
      target: 'lifeSphere',
    })
  })

  it('ignores non-version-conflict errors', () => {
    expect(
      getPlannerVersionConflict(
        new PlannerApiError('Server error.', {
          code: 'request_failed',
          status: 500,
        }),
      ),
    ).toBeNull()
    expect(getPlannerVersionConflict(new Error('Network down.'))).toBeNull()
  })
})
