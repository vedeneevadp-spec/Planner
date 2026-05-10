import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  createAliceCommandParser,
  parseCommandWithRules,
} from './alice-command-parser.js'

void describe('alice command parser', () => {
  const originalFetch = globalThis.fetch

  void afterEach(() => {
    globalThis.fetch = originalFetch
  })

  void it('parses explicit tasks with a planned time using rules', () => {
    const parsed = parseCommandWithRules({
      command: 'добавь задачу позвонить завтра в 9 часов',
      entities: [
        {
          type: 'YANDEX.DATETIME',
          value: {
            day: 1,
            day_is_relative: true,
            hour: 9,
            minute: 0,
          },
        },
      ],
      timeZone: 'UTC',
    })

    assert.equal(parsed.intent, 'create_task')

    if (parsed.intent !== 'create_task') {
      throw new Error('Expected task intent.')
    }

    assert.equal(parsed.title, 'позвонить')
    assert.equal(parsed.plannedStartTime, '09:00')
  })

  void it('parses reversed shopping phrasing using rules', () => {
    const parsed = parseCommandWithRules({
      command: 'запиши молоко в покупки',
      entities: [],
      timeZone: 'UTC',
    })

    assert.equal(parsed.intent, 'add_shopping_item')

    if (parsed.intent !== 'add_shopping_item') {
      throw new Error('Expected shopping intent.')
    }

    assert.equal(parsed.text, 'молоко')
  })

  void it('uses LLM fallback for non-obvious phrasing', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              confidence: 0.88,
              intent: 'add_shopping_item',
              planned_date: null,
              planned_start_time: null,
              range: null,
              text: 'овсянка',
              title: null,
            }),
          }),
          {
            headers: {
              'content-type': 'application/json',
            },
            status: 200,
          },
        ),
      )

    const parser = createAliceCommandParser({
      apiKey: 'test-key',
      endpoint: 'https://llm.local/responses',
      model: 'test-model',
      timeoutMs: 1000,
    })
    const parsed = await parser.parse({
      command: 'овсянку бы не забыть',
      entities: [],
      timeZone: 'UTC',
    })

    assert.equal(parsed.intent, 'add_shopping_item')

    if (parsed.intent !== 'add_shopping_item') {
      throw new Error('Expected shopping intent.')
    }

    assert.equal(parsed.source, 'llm')
    assert.equal(parsed.text, 'овсянка')
  })
})
