import type {
  OutboxHandlerMap,
  OutboxProcessResult,
  OutboxRepository,
} from './outbox.model.js'

export class OutboxService {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly handlers: OutboxHandlerMap = {},
  ) {}

  async processPending(limit = 100): Promise<OutboxProcessResult> {
    const messages = await this.repository.claimPending(limit)
    const result: OutboxProcessResult = {
      claimed: messages.length,
      completed: 0,
      failed: 0,
    }

    for (const message of messages) {
      const handler = this.handlers[message.topic] ?? noopOutboxHandler

      try {
        await handler(message)
        await this.repository.markCompleted(message.id)
        result.completed += 1
      } catch (error) {
        await this.repository.markFailed(message.id, getErrorMessage(error))
        result.failed += 1
      }
    }

    return result
  }
}

async function noopOutboxHandler(): Promise<void> {
  return Promise.resolve()
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown outbox handler error.'
}
