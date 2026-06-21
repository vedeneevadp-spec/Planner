import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { AiContextService } from '../ai-context/index.js'
import { executeMcpTool, MCP_HAOTIKA_TOOLS } from './mcp-haotika.tools.js'
import { McpHaotikaError } from './mcp-haotika.types.js'

void describe('MCP Haotika tools', () => {
  void it('declares only read-only tools', () => {
    assert.deepEqual(MCP_HAOTIKA_TOOLS.map((tool) => tool.name).sort(), [
      'get_overload_context',
      'get_selfcare_context',
      'get_today_context',
      'get_week_context',
      'search_planner',
    ])

    for (const tool of MCP_HAOTIKA_TOOLS) {
      assert.equal(tool.annotations.readOnlyHint, true)
      assert.equal(tool.annotations.destructiveHint, false)
      assert.equal(tool.annotations.openWorldHint, false)
      assert.equal(tool.securitySchemes[0]?.type, 'oauth2')
      assert.equal(tool.name.includes('write'), false)
      assert.equal(tool.name.includes('create'), false)
      assert.equal(tool.name.includes('update'), false)
      assert.equal(tool.name.includes('delete'), false)
    }
  })

  void it('search_planner requires a query', async () => {
    await assert.rejects(
      executeMcpTool({
        aiContextService: createFakeAiContextService(),
        arguments: {},
        name: 'search_planner',
        userId: 'user-id',
      }),
      (error) =>
        error instanceof McpHaotikaError && error.code === 'VALIDATION_ERROR',
    )
  })

  void it('get_today_context calls the core context service', async () => {
    const calls: unknown[] = []
    const aiContextService = {
      getTodayContext: (input: unknown) => {
        calls.push(input)

        return Promise.resolve({
          date: '2026-06-21',
          generatedAt: '2026-06-21T00:00:00.000Z',
          timezone: 'Europe/Astrakhan',
        })
      },
    } as unknown as AiContextService

    const result = await executeMcpTool({
      aiContextService,
      arguments: { date: '2026-06-21' },
      name: 'get_today_context',
      userId: 'user-id',
    })

    assert.equal((result as { date: string }).date, '2026-06-21')
    assert.deepEqual(calls, [
      {
        date: '2026-06-21',
        userId: 'user-id',
      },
    ])
  })
})

function createFakeAiContextService(): AiContextService {
  return {} as unknown as AiContextService
}
