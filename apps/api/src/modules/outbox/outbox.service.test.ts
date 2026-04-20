import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { OutboxMessage, OutboxRepository } from './outbox.model.js'
import { OutboxService } from './outbox.service.js'

function createOutboxMessage(id: number, topic: string): OutboxMessage {
  return {
    aggregateId: `00000000-0000-7000-8000-${String(id).padStart(12, '0')}`,
    aggregateType: 'task',
    attempts: 1,
    id,
    payload: {},
    topic,
  }
}

void describe('OutboxService', () => {
  void it('marks handled messages as completed and handler errors as failed', async () => {
    const completed: number[] = []
    const failed: Array<{ errorMessage: string; id: number }> = []
    const repository: OutboxRepository = {
      claimPending(limit) {
        assert.equal(limit, 2)

        return Promise.resolve([
          createOutboxMessage(1, 'task.created'),
          createOutboxMessage(2, 'task.deleted'),
        ])
      },
      markCompleted(id) {
        completed.push(id)

        return Promise.resolve()
      },
      markFailed(id, errorMessage) {
        failed.push({ errorMessage, id })

        return Promise.resolve()
      },
    }
    const service = new OutboxService(repository, {
      'task.created': async () => Promise.resolve(),
      'task.deleted': () =>
        Promise.reject(new Error('integration unavailable')),
    })

    const result = await service.processPending(2)

    assert.deepEqual(result, {
      claimed: 2,
      completed: 1,
      failed: 1,
    })
    assert.deepEqual(completed, [1])
    assert.deepEqual(failed, [
      {
        errorMessage: 'integration unavailable',
        id: 2,
      },
    ])
  })
})
