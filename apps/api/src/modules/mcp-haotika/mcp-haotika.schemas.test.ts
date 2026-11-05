import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getAiDateRangeError } from '../ai-context/ai-context.validation.js'
import type { AiContextService } from '../ai-context/index.js'
import { toolInputSchemas } from './mcp-haotika.schemas.js'
import { executeMcpTool } from './mcp-haotika.tools.js'
import { McpHaotikaError } from './mcp-haotika.types.js'

void describe('MCP context date validation', () => {
  void it('allows empty text only for bounded task completion history and task-only pagination', () => {
    const history = {
      query: '',
      types: ['tasks'],
      status: 'done',
      from: '2026-11-01',
      to: '2026-11-05',
    }
    assert.equal(
      toolInputSchemas.search_planner.safeParse(history).success,
      true,
    )
    assert.equal(
      toolInputSchemas.search_planner.safeParse({
        ...history,
        taskCursor: 'continuation',
      }).success,
      true,
    )
    assert.equal(
      toolInputSchemas.search_planner.safeParse({ ...history, status: 'todo' })
        .success,
      false,
    )
    assert.equal(
      toolInputSchemas.search_planner.safeParse({ ...history, to: undefined })
        .success,
      false,
    )
    assert.equal(
      toolInputSchemas.search_planner.safeParse({
        ...history,
        types: ['tasks', 'shopping'],
      }).success,
      false,
    )
    assert.equal(
      toolInputSchemas.search_planner.safeParse({
        query: 'test',
        taskCursor: 'continuation',
        types: ['shopping'],
      }).success,
      false,
    )
  })
  void it('rejects nonexistent days and invalid time zones before invoking a service', async () => {
    for (const args of [
      { date: '2026-02-30' },
      { date: '2026-13-01' },
      { date: '2026-11-05', timezone: 'Not/AZone' },
    ]) {
      await assert.rejects(
        executeMcpTool({
          aiContextService: {} as AiContextService,
          arguments: args,
          name: 'get_today_context',
          userId: 'user-id',
        }),
        (error) =>
          error instanceof McpHaotikaError && error.code === 'VALIDATION_ERROR',
      )
    }
    assert.equal(
      toolInputSchemas.get_today_context.safeParse({
        date: '2028-02-29',
        timezone: 'Asia/Novosibirsk',
      }).success,
      true,
    )
  })

  for (const name of [
    'get_week_context',
    'get_overload_context',
    'get_selfcare_context',
    'search_planner',
  ] as const) {
    void it(`${name} validates the whole requested period instead of truncating it`, () => {
      const base = name === 'search_planner' ? { query: 'documents' } : {}
      for (const range of [
        { from: '2026-06-31', to: '2026-07-01' },
        { from: '2026-07-10', to: '2026-07-01' },
        { from: '2026-07-01', to: '2026-08-01' },
      ]) {
        assert.equal(
          toolInputSchemas[name].safeParse({ ...base, ...range }).success,
          false,
        )
      }
      assert.equal(
        toolInputSchemas[name].safeParse({
          ...base,
          from: '2026-07-01',
          to: '2026-07-31',
        }).success,
        true,
      )
      assert.equal(
        toolInputSchemas[name].safeParse({ ...base, from: '2026-07-01' })
          .success,
        true,
      )
      assert.equal(
        toolInputSchemas[name].safeParse({ ...base, timezone: 'bad-zone' })
          .success,
        false,
      )
    })
  }

  void it('passes an explicit search time zone to the context service', async () => {
    const calls: unknown[] = []
    await executeMcpTool({
      aiContextService: {
        searchPlanner(input: unknown) {
          calls.push(input)
          return Promise.resolve({ items: [] })
        },
      } as unknown as AiContextService,
      arguments: { query: 'documents', timezone: 'Asia/Novosibirsk' },
      name: 'search_planner',
      userId: 'user-id',
    })
    assert.deepEqual(calls, [
      { query: 'documents', timezone: 'Asia/Novosibirsk', userId: 'user-id' },
    ])
  })

  void it('shares calendar and range validation with direct service calls', () => {
    assert.notEqual(getAiDateRangeError('2026-02-30'), null)
    assert.notEqual(getAiDateRangeError('2026-07-10', '2026-07-01'), null)
    assert.notEqual(getAiDateRangeError('2026-07-01', '2026-08-01'), null)
    assert.equal(getAiDateRangeError('2026-07-01', '2026-07-31'), null)
  })
})
