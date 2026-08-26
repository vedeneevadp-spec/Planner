import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import type { TaskCursorAnchor, TaskCursorFilters } from './task.model.js'

interface TaskCursorPayload extends TaskCursorAnchor {
  dateFrom: string | null
  dateMode: TaskCursorFilters['dateMode']
  dateTo: string | null
  direction: TaskCursorFilters['direction']
  scope: TaskCursorFilters['scope']
  version: 1
}

export function encodeTaskCursor(
  anchor: TaskCursorAnchor,
  filters: TaskCursorFilters,
): string {
  const payload: TaskCursorPayload = {
    ...anchor,
    dateFrom: filters.dateFrom ?? null,
    dateMode: filters.dateMode,
    dateTo: filters.dateTo ?? null,
    direction: filters.direction,
    scope: filters.scope,
    version: 1,
  }

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeTaskCursor(
  cursor: string | undefined,
  filters: TaskCursorFilters,
): TaskCursorAnchor | undefined {
  if (!cursor) {
    return undefined
  }

  try {
    const payload = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<TaskCursorPayload>

    if (
      payload.version !== 1 ||
      typeof payload.createdAt !== 'string' ||
      Number.isNaN(Date.parse(payload.createdAt)) ||
      typeof payload.id !== 'string' ||
      !z.string().uuid().safeParse(payload.id).success ||
      payload.dateFrom !== (filters.dateFrom ?? null) ||
      payload.dateTo !== (filters.dateTo ?? null) ||
      payload.dateMode !== filters.dateMode ||
      payload.direction !== filters.direction ||
      payload.scope !== filters.scope
    ) {
      throw new Error('Cursor payload does not match the query.')
    }

    return {
      createdAt: payload.createdAt,
      id: payload.id,
    }
  } catch {
    throw new HttpError(
      400,
      'invalid_task_cursor',
      'Task cursor is invalid or belongs to a different query.',
    )
  }
}
