import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { AiContextService } from '../ai-context/index.js'
import {
  getTodayContextInputSchema,
  getWeekContextInputSchema,
  jsonSchemas,
  searchPlannerInputSchema,
} from './mcp-haotika.schemas.js'
import {
  executeMcpTool,
  getRequiredScopesForTool,
  MCP_HAOTIKA_TOOLS,
} from './mcp-haotika.tools.js'
import { McpHaotikaError } from './mcp-haotika.types.js'

void describe('MCP Haotika tools', () => {
  void it('preserves read-only context and accurately declares six scoped write actions', () => {
    const writeNames = [
      'complete_shopping_item',
      'complete_task',
      'create_shopping_item',
      'create_task',
      'update_shopping_item',
      'update_task',
    ]
    assert.deepEqual(
      MCP_HAOTIKA_TOOLS.filter((tool) => !tool.annotations.readOnlyHint)
        .map((tool) => tool.name)
        .sort(),
      writeNames,
    )
    assert.deepEqual(
      MCP_HAOTIKA_TOOLS.filter((tool) => tool.annotations.readOnlyHint)
        .map((tool) => tool.name)
        .sort(),
      [
        'get_overload_context',
        'get_selfcare_context',
        'get_shopping_item',
        'get_task',
        'get_today_context',
        'get_week_context',
        'list_shopping',
        'list_tasks',
        'search_planner',
      ],
    )

    for (const tool of MCP_HAOTIKA_TOOLS) {
      assert.equal(
        tool.annotations.destructiveHint,
        tool.name === 'update_task' || tool.name === 'update_shopping_item',
      )
      assert.equal(tool.annotations.openWorldHint, false)
      assert.equal(tool.securitySchemes[0]?.type, 'oauth2')
      assert.equal(tool.name.includes('delete'), false)
      assert.equal(
        tool.securitySchemes[0]?.scopes.some((scope) =>
          scope.endsWith('.write'),
        ),
        !tool.annotations.readOnlyHint,
      )
    }
  })

  void it('publishes search pagination, timezone and the current write instructions', () => {
    assert.ok(jsonSchemas.search_planner.properties.taskCursor)
    assert.ok(jsonSchemas.search_planner.properties.timezone)
    for (const name of ['create_task', 'create_shopping_item'] as const) {
      assert.ok((jsonSchemas[name].required as string[]).includes('id'))
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

  void it('bounds array inputs in runtime and advertised schemas', () => {
    assert.equal(
      getTodayContextInputSchema.safeParse({
        include: Array.from({ length: 8 }, () => 'tasks'),
      }).success,
      false,
    )
    assert.equal(
      getWeekContextInputSchema.safeParse({
        include: Array.from({ length: 21 }, () => 'tasks'),
      }).success,
      false,
    )
    assert.equal(
      searchPlannerInputSchema.safeParse({
        query: 'plan',
        types: Array.from({ length: 7 }, () => 'tasks'),
      }).success,
      false,
    )

    assert.equal(readMaxItems('get_today_context', 'include'), 7)
    assert.equal(readMaxItems('get_week_context', 'include'), 6)
    assert.equal(readMaxItems('search_planner', 'types'), 6)
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

  void it('validates weekly section names and requires only the requested scopes', () => {
    for (const include of [
      ['tasks'],
      ['calendar'],
      ['shopping'],
      ['cleaning'],
      ['selfcare'],
      ['stats'],
    ]) {
      assert.equal(
        getWeekContextInputSchema.safeParse({ include }).success,
        true,
      )
      assert.deepEqual(
        getRequiredScopesForTool('get_week_context', { include }),
        [`haotika:${include[0]}.read`],
      )
    }
    assert.equal(
      getWeekContextInputSchema.safeParse({ include: ['invented'] }).success,
      false,
    )
    assert.deepEqual(
      jsonSchemas.get_week_context.properties.include.items.enum,
      ['tasks', 'calendar', 'shopping', 'cleaning', 'selfcare', 'stats'],
    )
    assert.deepEqual(
      getRequiredScopesForTool('get_week_context', { include: [] }),
      getRequiredScopesForTool('get_week_context', {}),
    )
    assert.equal(getRequiredScopesForTool('get_week_context', {}).length, 6)
  })
})

function createFakeAiContextService(): AiContextService {
  return {} as unknown as AiContextService
}

function readMaxItems(
  toolName: keyof typeof jsonSchemas,
  propertyName: string,
): unknown {
  const schema = jsonSchemas[toolName] as {
    properties: Record<string, { maxItems?: unknown }>
  }

  return schema.properties[propertyName]?.maxItems
}
