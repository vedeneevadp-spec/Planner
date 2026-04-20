import type { JsonObject } from '../../infrastructure/db/schema.js'

export interface OutboxMessage {
  aggregateId: string
  aggregateType: string
  attempts: number
  id: number
  payload: JsonObject
  topic: string
}

export interface OutboxRepository {
  claimPending(limit: number): Promise<OutboxMessage[]>
  markCompleted(id: number): Promise<void>
  markFailed(id: number, errorMessage: string): Promise<void>
}

export type OutboxHandler = (message: OutboxMessage) => Promise<void>

export type OutboxHandlerMap = Partial<Record<string, OutboxHandler>>

export interface OutboxProcessResult {
  claimed: number
  completed: number
  failed: number
}
