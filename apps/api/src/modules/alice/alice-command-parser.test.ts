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
      apiFormat: 'responses',
      apiKey: 'test-key',
      endpoint: 'https://llm.local/responses',
      model: 'test-model',
      provider: 'openai',
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

  void it('uses YandexGPT Lite chat completions fallback for non-obvious phrasing', async () => {
    let authorizationHeader: string | undefined
    let requestBody: unknown

    globalThis.fetch = (_url, init) => {
      authorizationHeader = readAuthorizationHeader(init?.headers)
      const body = init?.body

      if (typeof body !== 'string') {
        throw new Error('Expected string request body.')
      }

      requestBody = JSON.parse(body)

      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: {
                  content: JSON.stringify({
                    confidence: 0.9,
                    intent: 'create_task',
                    planned_date: null,
                    planned_start_time: null,
                    range: null,
                    text: null,
                    title: 'разобрать документы',
                  }),
                  role: 'assistant',
                },
              },
            ],
          }),
          {
            headers: {
              'content-type': 'application/json',
            },
            status: 200,
          },
        ),
      )
    }

    const parser = createAliceCommandParser({
      apiFormat: 'chat_completions',
      apiKey: 'yandex-key',
      endpoint: 'https://ai.api.cloud.yandex.net/v1/chat/completions',
      model: 'gpt://folder-id/yandexgpt-5-lite',
      provider: 'yandex',
      timeoutMs: 1000,
    })
    const parsed = await parser.parse({
      command: 'документы бы сегодня разобрать',
      entities: [],
      timeZone: 'UTC',
    })

    assert.equal(parsed.intent, 'create_task')

    if (parsed.intent !== 'create_task') {
      throw new Error('Expected task intent.')
    }

    assert.equal(parsed.source, 'llm')
    assert.equal(parsed.title, 'разобрать документы')
    assert.equal(authorizationHeader, 'Api-Key yandex-key')
    assert.ok(isRecord(requestBody))
    assert.equal(requestBody.model, 'gpt://folder-id/yandexgpt-5-lite')
    assert.ok(isRecord(requestBody.response_format))
    assert.equal(requestBody.response_format.type, 'json_schema')
    assert.ok(isRecord(requestBody.response_format.json_schema))
    assert.equal(
      requestBody.response_format.json_schema.name,
      'alice_command_parse',
    )
    assert.equal(requestBody.response_format.json_schema.strict, true)
  })
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function readAuthorizationHeader(headers: unknown): string {
  if (headers instanceof Headers) {
    return headers.get('authorization') ?? ''
  }

  if (isUnknownArray(headers)) {
    for (const header of headers) {
      if (!isUnknownArray(header)) {
        continue
      }

      const key = header[0]
      const value = header[1]

      if (
        typeof key === 'string' &&
        typeof value === 'string' &&
        key.toLowerCase() === 'authorization'
      ) {
        return value
      }
    }
  }

  if (!isRecord(headers)) {
    return ''
  }

  return typeof headers.authorization === 'string' ? headers.authorization : ''
}
