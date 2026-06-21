import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createToolOutputSummary,
  MemoryMcpAuditLogRepository,
} from './mcp-haotika.audit.js'

void describe('MCP audit logs', () => {
  void it('logs redacted input and count-only output summary', async () => {
    const repository = new MemoryMcpAuditLogRepository()
    const output = {
      tasks: {
        today: [{ note: 'private note', title: 'Private task' }],
        totalCount: 12,
      },
      shopping: {
        totalCount: 5,
        urgent: [{ title: 'Medicine' }],
      },
    }

    await repository.createLog({
      input: {
        authorization: 'Bearer plain-token',
        query: 'milk',
        refreshToken: 'plain-refresh-token',
      },
      ipHash: 'ip-hash',
      outputSummary: createToolOutputSummary(output),
      tokenId: 'token-id',
      toolName: 'get_today_context',
      userAgent: 'test',
      userId: 'user-id',
    })

    assert.equal(repository.logs.length, 1)
    assert.deepEqual(repository.logs[0]?.input, { query: 'milk' })
    assert.deepEqual(repository.logs[0]?.outputSummary, {
      shoppingItemsCount: 5,
      tasksCount: 12,
    })
    assert.equal(
      JSON.stringify(repository.logs[0]).includes('private note'),
      false,
    )
    assert.equal(
      JSON.stringify(repository.logs[0]).includes('plain-token'),
      false,
    )
  })
})
