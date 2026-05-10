import { sql } from 'kysely'

import type { DatabaseExecutor } from '../../infrastructure/db/rls.js'
import type { JsonObject } from '../../infrastructure/db/schema.js'

export async function syncTaskReminder(
  executor: DatabaseExecutor,
  params: {
    isActive: boolean
    plannedDate: string | null
    plannedStartTime: string | null
    remindBeforeStart: boolean
    reminderTimeZone: string | undefined
    taskId: string
    userId: string
    workspaceId: string
  },
): Promise<void> {
  await sql`
    select app.sync_task_reminder(
      cast(${params.taskId} as uuid),
      cast(${params.workspaceId} as uuid),
      cast(${params.userId} as uuid),
      ${params.remindBeforeStart},
      cast(${params.plannedDate} as date),
      cast(${params.plannedStartTime} as time),
      cast(${params.reminderTimeZone ?? null} as text),
      ${params.isActive}
    )
  `.execute(executor)
}

export async function writeTaskMutationArtifacts(
  executor: DatabaseExecutor,
  params: {
    actorUserId: string
    eventType: string
    payload: JsonObject
    taskId: string
    workspaceId: string
  },
): Promise<void> {
  await executor
    .insertInto('app.task_events')
    .values({
      actor_user_id: params.actorUserId,
      event_type: params.eventType,
      payload: params.payload,
      task_id: params.taskId,
      workspace_id: params.workspaceId,
    })
    .executeTakeFirst()
}
