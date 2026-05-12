import { type Kysely, sql } from 'kysely'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import {
  type DatabaseExecutor,
  withOptionalRls,
} from '../../infrastructure/db/rls.js'
import type {
  DatabaseSchema,
  JsonObject,
} from '../../infrastructure/db/schema.js'
import { TaskNotFoundError, TaskVersionConflictError } from './task.errors.js'
import { loadCurrentTask } from './task.repository.postgres.queries.js'
import {
  MANUAL_TIME_BLOCK_SOURCE,
  TASK_REMIND_BEFORE_START_KEY,
  type TaskTimeBlockRow,
} from './task.repository.postgres.types.js'
import type { normalizeTaskSchedule } from './task.shared.js'

export function shouldUsePoolerWriteFallback(
  authContext: AuthenticatedRequestContext | null,
): authContext is AuthenticatedRequestContext {
  return authContext !== null && process.env.API_DB_WRITE_FALLBACK === 'pooler'
}

export function executePoolerWriteStatement<T>(
  db: Kysely<DatabaseSchema>,
  authContext: AuthenticatedRequestContext,
  actorUserId: string,
  callback: (executor: Kysely<DatabaseSchema>) => Promise<T>,
): Promise<T> {
  return withOptionalRls(
    db,
    authContext,
    (executor) => callback(executor as Kysely<DatabaseSchema>),
    actorUserId,
  )
}

export async function resolveTaskWriteConflict(
  db: Kysely<DatabaseSchema>,
  authContext: AuthenticatedRequestContext,
  actorUserId: string,
  command: {
    context: {
      workspaceId: string
    }
    expectedVersion?: number
    taskId: string
  },
  message: string,
): Promise<never> {
  const currentTask = await executePoolerWriteStatement(
    db,
    authContext,
    actorUserId,
    (executor) => loadCurrentTask(executor, command),
  )

  if (!currentTask) {
    throw new TaskNotFoundError(command.taskId)
  }

  if (
    command.expectedVersion !== undefined &&
    Number(currentTask.version) !== command.expectedVersion
  ) {
    throw new TaskVersionConflictError(
      command.taskId,
      command.expectedVersion,
      Number(currentTask.version),
    )
  }

  throw new Error(message)
}

export function insertPrimaryTimeBlock(
  executor: DatabaseExecutor,
  params: {
    actorUserId: string
    endsAt: string | null
    startsAt: string | null
    taskId: string
    workspaceId: string
  },
): Promise<TaskTimeBlockRow | undefined> {
  if (!params.startsAt || !params.endsAt) {
    return Promise.resolve(undefined)
  }

  return executor
    .insertInto('app.task_time_blocks')
    .values({
      created_by: params.actorUserId,
      ends_at: params.endsAt,
      metadata: {},
      position: 0,
      source: MANUAL_TIME_BLOCK_SOURCE,
      starts_at: params.startsAt,
      task_id: params.taskId,
      timezone: 'UTC',
      updated_by: params.actorUserId,
      workspace_id: params.workspaceId,
    })
    .returningAll()
    .executeTakeFirst()
}

export function buildScheduleUpdateMetadataValue(
  schedule: ReturnType<typeof normalizeTaskSchedule>,
) {
  return sql<JsonObject>`
    case
      when cast(${schedule.plannedDate} as date) is null
        or cast(${schedule.plannedStartTime} as time) is null
      then coalesce(metadata, '{}'::jsonb) - cast(${TASK_REMIND_BEFORE_START_KEY} as text)
      else metadata
    end
  `
}
