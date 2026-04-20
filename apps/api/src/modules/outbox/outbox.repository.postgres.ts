import { type Kysely, sql } from 'kysely'

import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type { OutboxMessage, OutboxRepository } from './outbox.model.js'

interface OutboxMessageRow {
  aggregate_id: string
  aggregate_type: string
  attempts: number
  id: number
  payload: Record<string, unknown>
  topic: string
}

export class PostgresOutboxRepository implements OutboxRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async claimPending(limit: number): Promise<OutboxMessage[]> {
    const result = await sql<OutboxMessageRow>`
      with candidate as (
        select id
        from app.outbox
        where status in ('pending', 'failed')
          and available_at <= now()
        order by available_at asc, id asc
        limit ${limit}
        for update skip locked
      )
      update app.outbox as outbox
      set
        attempts = outbox.attempts + 1,
        last_error = null,
        locked_at = now(),
        status = 'processing'
      from candidate
      where outbox.id = candidate.id
      returning
        outbox.aggregate_id,
        outbox.aggregate_type,
        outbox.attempts,
        outbox.id,
        outbox.payload,
        outbox.topic
    `.execute(this.db)

    return result.rows.map((row) => ({
      aggregateId: row.aggregate_id,
      aggregateType: row.aggregate_type,
      attempts: Number(row.attempts),
      id: Number(row.id),
      payload: row.payload,
      topic: row.topic,
    }))
  }

  async markCompleted(id: number): Promise<void> {
    await this.db
      .updateTable('app.outbox')
      .set({
        last_error: null,
        locked_at: null,
        processed_at: new Date().toISOString(),
        status: 'completed',
      })
      .where('id', '=', id)
      .executeTakeFirst()
  }

  async markFailed(id: number, errorMessage: string): Promise<void> {
    await this.db
      .updateTable('app.outbox')
      .set({
        available_at: sql`now() + interval '60 seconds'`,
        last_error: errorMessage,
        locked_at: null,
        status: 'failed',
      })
      .where('id', '=', id)
      .executeTakeFirst()
  }
}
