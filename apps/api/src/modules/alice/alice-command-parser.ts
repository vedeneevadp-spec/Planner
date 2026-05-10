import { z } from 'zod'

import type { AliceCommandLlmConfig } from '../../bootstrap/config.js'

const DEFAULT_TIME_ZONE = 'Europe/Moscow'
const MIN_LLM_CONFIDENCE = 0.55

export interface AliceCommandParserInput {
  command: string
  entities: AliceNluEntity[]
  originalUtterance?: string | undefined
  timeZone?: string | undefined
}

export interface AliceNluEntity {
  type: string
  value?: unknown
}

export type AliceParsedCommand =
  | AliceParsedHelpCommand
  | AliceParsedExitCommand
  | AliceParsedPingCommand
  | AliceParsedCreateTaskCommand
  | AliceParsedShoppingCommand
  | AliceParsedListTasksCommand
  | AliceParsedUnknownCommand

export interface AliceParsedHelpCommand {
  confidence: number
  intent: 'help'
  source: AliceCommandParseSource
}

export interface AliceParsedExitCommand {
  confidence: number
  intent: 'exit'
  source: AliceCommandParseSource
}

export interface AliceParsedPingCommand {
  confidence: number
  intent: 'ping'
  source: AliceCommandParseSource
}

export interface AliceParsedCreateTaskCommand {
  confidence: number
  intent: 'create_task'
  plannedDate: string | null
  plannedEndTime: string | null
  plannedStartTime: string | null
  reminderTimeZone: string | undefined
  source: AliceCommandParseSource
  title: string
}

export interface AliceParsedShoppingCommand {
  confidence: number
  intent: 'add_shopping_item'
  source: AliceCommandParseSource
  text: string
}

export interface AliceParsedListTasksCommand {
  confidence: number
  intent: 'list_tasks'
  plannedDate: string
  range: 'today' | 'tomorrow'
  source: AliceCommandParseSource
}

export interface AliceParsedUnknownCommand {
  confidence: number
  intent: 'unknown'
  source: AliceCommandParseSource
}

export interface AliceCommandParser {
  parse(input: AliceCommandParserInput): Promise<AliceParsedCommand>
}

type AliceCommandParseSource = 'llm' | 'rules'

interface RuleParseOptions {
  allowImplicitTask: boolean
}

interface TaskDraft {
  plannedDate: string | null
  plannedEndTime: string | null
  plannedStartTime: string | null
  reminderTimeZone: string | undefined
  title: string
}

interface ScheduleDraft {
  plannedDate: string | null
  plannedStartTime: string | null
  reminderTimeZone: string | undefined
}

interface AliceCommandLlmClient {
  createCommandCompletion(
    input: AliceCommandParserInput,
  ): Promise<string | null>
}

interface LlmAliceCommandParser {
  parse(input: AliceCommandParserInput): Promise<AliceParsedCommand | null>
}

const llmCommandSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    intent: z.enum([
      'create_task',
      'add_shopping_item',
      'list_tasks',
      'help',
      'exit',
      'unknown',
    ]),
    planned_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable(),
    planned_start_time: z
      .string()
      .regex(/^\d{2}:\d{2}$/u)
      .nullable(),
    range: z.enum(['today', 'tomorrow']).nullable(),
    text: z.string().trim().min(1).max(300).nullable(),
    title: z.string().trim().min(1).max(300).nullable(),
  })
  .superRefine((value, context) => {
    if (value.intent === 'create_task' && !value.title) {
      context.addIssue({
        code: 'custom',
        message: 'create_task requires title.',
        path: ['title'],
      })
    }

    if (value.intent === 'add_shopping_item' && !value.text) {
      context.addIssue({
        code: 'custom',
        message: 'add_shopping_item requires text.',
        path: ['text'],
      })
    }

    if (value.intent === 'list_tasks' && !value.range) {
      context.addIssue({
        code: 'custom',
        message: 'list_tasks requires range.',
        path: ['range'],
      })
    }
  })

const llmStructuredOutputSchema = {
  additionalProperties: false,
  properties: {
    confidence: { maximum: 1, minimum: 0, type: 'number' },
    intent: {
      enum: [
        'create_task',
        'add_shopping_item',
        'list_tasks',
        'help',
        'exit',
        'unknown',
      ],
      type: 'string',
    },
    planned_date: {
      anyOf: [
        { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
        { type: 'null' },
      ],
    },
    planned_start_time: {
      anyOf: [{ pattern: '^\\d{2}:\\d{2}$', type: 'string' }, { type: 'null' }],
    },
    range: {
      anyOf: [
        { enum: ['today', 'tomorrow'], type: 'string' },
        { type: 'null' },
      ],
    },
    text: {
      anyOf: [
        { maxLength: 300, minLength: 1, type: 'string' },
        { type: 'null' },
      ],
    },
    title: {
      anyOf: [
        { maxLength: 300, minLength: 1, type: 'string' },
        { type: 'null' },
      ],
    },
  },
  required: [
    'intent',
    'title',
    'text',
    'planned_date',
    'planned_start_time',
    'range',
    'confidence',
  ],
  type: 'object',
}

export function createAliceCommandParser(
  llmConfig: AliceCommandLlmConfig | null,
): AliceCommandParser {
  const llmParser = llmConfig
    ? new ProviderBackedAliceCommandParser(
        createAliceCommandLlmClient(llmConfig),
      )
    : null

  return {
    async parse(input) {
      const ruleResult = parseCommandWithRules(input, {
        allowImplicitTask: !llmParser,
      })

      if (isConfidentRuleResult(ruleResult)) {
        return ruleResult
      }

      if (!llmParser) {
        return ruleResult
      }

      const llmResult = await llmParser.parse(input)

      if (llmResult && llmResult.confidence >= MIN_LLM_CONFIDENCE) {
        return llmResult
      }

      if (ruleResult.intent !== 'unknown') {
        return ruleResult
      }

      return { confidence: 0, intent: 'unknown', source: 'rules' }
    },
  }
}

export function parseCommandWithRules(
  input: AliceCommandParserInput,
  options: RuleParseOptions = { allowImplicitTask: true },
): AliceParsedCommand {
  const command = getNormalizedCommand(input.command)

  if (isPingCommand(command, input.originalUtterance)) {
    return { confidence: 1, intent: 'ping', source: 'rules' }
  }

  if (isExitCommand(command)) {
    return { confidence: 1, intent: 'exit', source: 'rules' }
  }

  if (isHelpCommand(command)) {
    return { confidence: 1, intent: 'help', source: 'rules' }
  }

  const listTasksDraft = createListTasksDraft(command, input)

  if (listTasksDraft) {
    return {
      confidence: 0.96,
      intent: 'list_tasks',
      plannedDate: listTasksDraft.plannedDate,
      range: listTasksDraft.range,
      source: 'rules',
    }
  }

  const shoppingText = createShoppingDraft(command)

  if (shoppingText) {
    return {
      confidence: 0.98,
      intent: 'add_shopping_item',
      source: 'rules',
      text: shoppingText,
    }
  }

  const taskDraft = createTaskDraft(input, {
    allowImplicitTask: options.allowImplicitTask,
  })

  if (!taskDraft) {
    return { confidence: 0, intent: 'unknown', source: 'rules' }
  }

  return {
    confidence: options.allowImplicitTask ? 0.65 : 0.98,
    intent: 'create_task',
    plannedDate: taskDraft.plannedDate,
    plannedEndTime: taskDraft.plannedEndTime,
    plannedStartTime: taskDraft.plannedStartTime,
    reminderTimeZone: taskDraft.reminderTimeZone,
    source: 'rules',
    title: taskDraft.title,
  }
}

export function normalizeTimeZone(value: string | undefined): string {
  const timeZone = value?.trim() || DEFAULT_TIME_ZONE

  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone }).format(new Date())
    return timeZone
  } catch {
    return DEFAULT_TIME_ZONE
  }
}

export function getDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date)

  return formatDateKey(
    Number(parts.find((part) => part.type === 'year')?.value),
    Number(parts.find((part) => part.type === 'month')?.value),
    Number(parts.find((part) => part.type === 'day')?.value),
  )
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const { day, month, year } = parseDateKey(dateKey)
  const date = new Date(Date.UTC(year, month - 1, day + days))

  return formatDateKey(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  )
}

function isConfidentRuleResult(result: AliceParsedCommand): boolean {
  return (
    result.intent === 'ping' ||
    result.intent === 'exit' ||
    result.intent === 'help' ||
    result.intent === 'list_tasks' ||
    result.intent === 'add_shopping_item' ||
    (result.intent === 'create_task' && result.confidence >= 0.9)
  )
}

function createListTasksDraft(
  command: string,
  input: AliceCommandParserInput,
): { plannedDate: string; range: 'today' | 'tomorrow' } | null {
  const normalized = normalizeRussianText(command)

  if (!normalized || isMutatingCommand(normalized)) {
    return null
  }

  const hasToday = /(?:^|\s)(?:сегодня|на\s+сегодня)(?=$|\s)/u.test(normalized)
  const hasTomorrow = /(?:^|\s)(?:завтра|на\s+завтра)(?=$|\s)/u.test(normalized)
  const asksForList =
    /(?:^|\s)(?:какие|что|прочитай|зачитай|покажи|перечисли|назови|скажи|список|план|планы|запланировано)(?=$|\s)/u.test(
      normalized,
    ) &&
    (/(?:^|\s)(?:задачи|задач|дела|дел|план|планы|запланировано)(?=$|\s)/u.test(
      normalized,
    ) ||
      /^(?:что|какие)\s+у\s+меня\b/u.test(normalized))

  if (!asksForList || (!hasToday && !hasTomorrow)) {
    return null
  }

  const timeZone = normalizeTimeZone(input.timeZone)
  const todayKey = getDateKeyInTimeZone(new Date(), timeZone)
  const range = hasTomorrow ? 'tomorrow' : 'today'

  return {
    plannedDate: range === 'today' ? todayKey : addDaysToDateKey(todayKey, 1),
    range,
  }
}

function createShoppingDraft(command: string): string | null {
  if (isExplicitTaskCommand(command)) {
    return null
  }

  const text = stripShoppingCommand(command)

  if (!text) {
    return null
  }

  return text
}

function createTaskDraft(
  input: AliceCommandParserInput,
  options: { allowImplicitTask: boolean },
): TaskDraft | null {
  const command = getNormalizedCommand(input.command)
  const strippedTitle = stripTaskCommand(command, options)

  if (!strippedTitle) {
    return null
  }

  const schedule = resolveSchedule(input)
  const title = stripSchedulePhrases(strippedTitle)

  if (!title) {
    return null
  }

  return {
    plannedDate: schedule.plannedDate,
    plannedEndTime: null,
    plannedStartTime: schedule.plannedStartTime,
    reminderTimeZone: schedule.reminderTimeZone,
    title,
  }
}

function stripTaskCommand(
  command: string,
  options: { allowImplicitTask: boolean },
): string {
  const normalized = normalizeRussianText(command)
  const patterns = [
    /^(?:пожалуйста\s+)?(?:добавь|добавить|создай|создать|запиши|записать|поставь|поставить|запланируй|запланировать)\s+(?:мне\s+)?(?:(?:задачу|дело|напоминание)\s+)?/u,
    /^(?:пожалуйста\s+)?напомни\s+(?:мне\s+)?/u,
    /^новая\s+задача\s+/u,
  ]

  for (const pattern of patterns) {
    const title = normalizeWhitespace(normalized.replace(pattern, ''))

    if (title !== normalized) {
      return title
    }
  }

  return options.allowImplicitTask ? normalized : ''
}

function isExplicitTaskCommand(command: string): boolean {
  return /^(?:пожалуйста\s+)?(?:добавь|добавить|создай|создать|запиши|записать|поставь|поставить|запланируй|запланировать)\s+(?:мне\s+)?(?:задачу|дело)\b/u.test(
    command,
  )
}

function isMutatingCommand(command: string): boolean {
  return /^(?:пожалуйста\s+)?(?:добавь|добавить|создай|создать|запиши|записать|поставь|поставить|запланируй|запланировать|напомни|купи|купить|надо|нужно)\b/u.test(
    command,
  )
}

function stripShoppingCommand(command: string): string {
  const normalized = normalizeRussianText(command)
  const patterns = [
    /^(?:пожалуйста\s+)?(?:мне\s+)?(?:надо|нужно|нужна|нужен|нужны)\s+купить\s+/u,
    /^(?:пожалуйста\s+)?(?:купи|купить)\s+/u,
    /^(?:пожалуйста\s+)?(?:добавь|добавить|запиши|записать)\s+(?:мне\s+)?(?:в\s+)?(?:список\s+)?покуп(?:ок|ки)\s+/u,
    /^(?:пожалуйста\s+)?(?:добавь|добавить|запиши|записать)\s+(?:мне\s+)?(?:в\s+)?список\s+покупок\s+/u,
    /^(?:пожалуйста\s+)?(?:запиши|добавь)\s+(.+?)\s+в\s+(?:список\s+)?покуп(?:ок|ки)$/u,
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)

    if (match?.[1]) {
      return normalizeWhitespace(match[1])
    }

    const text = normalizeWhitespace(normalized.replace(pattern, ''))

    if (text !== normalized) {
      return text
    }
  }

  return ''
}

function resolveSchedule(input: AliceCommandParserInput): ScheduleDraft {
  const timeZone = normalizeTimeZone(input.timeZone)
  const todayKey = getDateKeyInTimeZone(new Date(), timeZone)
  const nluSchedule = resolveNluSchedule(input.entities, todayKey)
  const command = getNormalizedCommand(input.command)
  const plannedDate =
    nluSchedule.plannedDate ?? resolveTextDate(command, todayKey)
  const plannedStartTime =
    nluSchedule.plannedStartTime ?? resolveTextTime(command)

  return {
    plannedDate: plannedDate ?? (plannedStartTime ? todayKey : null),
    plannedStartTime,
    reminderTimeZone: timeZone,
  }
}

function resolveNluSchedule(
  entities: AliceNluEntity[],
  todayKey: string,
): {
  plannedDate?: string | null
  plannedStartTime?: string | null
} {
  const dateTimeEntity = entities.find(
    (entity) => entity.type === 'YANDEX.DATETIME',
  )

  if (!dateTimeEntity || !isRecord(dateTimeEntity.value)) {
    return {}
  }

  return parseYandexDateTimeValue(dateTimeEntity.value, todayKey)
}

function parseYandexDateTimeValue(
  value: Record<string, unknown>,
  todayKey: string,
): {
  plannedDate?: string | null
  plannedStartTime?: string | null
} {
  const result: {
    plannedDate?: string | null
    plannedStartTime?: string | null
  } = {}
  const day = readInteger(value.day)
  const month = readInteger(value.month)
  const year = readInteger(value.year)
  const hour = readInteger(value.hour)
  const minute = readInteger(value.minute)

  if (day !== undefined && value.day_is_relative === true) {
    result.plannedDate = addDaysToDateKey(todayKey, day)
  } else if (day !== undefined && month !== undefined) {
    const resolvedYear = year ?? resolveYearForMonthDay(todayKey, month, day)
    result.plannedDate = formatDateKey(resolvedYear, month, day)
  }

  if (hour !== undefined && value.hour_is_relative !== true) {
    result.plannedStartTime = formatTimeKey(hour, minute ?? 0)
  }

  return result
}

function resolveTextDate(command: string, todayKey: string): string | null {
  const normalized = normalizeRussianText(command)

  if (/(?:^|\s)послезавтра(?=$|\s)/u.test(normalized)) {
    return addDaysToDateKey(todayKey, 2)
  }

  if (/(?:^|\s)завтра(?=$|\s)/u.test(normalized)) {
    return addDaysToDateKey(todayKey, 1)
  }

  if (/(?:^|\s)сегодня(?=$|\s)/u.test(normalized)) {
    return todayKey
  }

  const targetWeekday = findTargetWeekday(normalized)

  if (targetWeekday === null) {
    return null
  }

  return addDaysToDateKey(
    todayKey,
    getDaysUntilWeekday(todayKey, targetWeekday),
  )
}

function resolveTextTime(command: string): string | null {
  const normalized = normalizeRussianText(command)
  const timeWithMinutes = normalized.match(
    /(?:^|\s)(?:в|к|на)\s+(\d{1,2})(?::|\s+)(\d{1,2})(?:\s*(утра|дня|вечера|ночи))?(?=$|\s)/u,
  )

  if (timeWithMinutes) {
    return formatMatchedTime(timeWithMinutes[1], timeWithMinutes[2], [
      timeWithMinutes[3],
    ])
  }

  const timeWithHour = normalized.match(
    /(?:^|\s)(?:в|к|на)\s+(\d{1,2})(?:\s*(час(?:а|ов)?))?(?:\s*(утра|дня|вечера|ночи))?(?=$|\s)/u,
  )

  if (!timeWithHour || (!timeWithHour[2] && !timeWithHour[3])) {
    return null
  }

  return formatMatchedTime(timeWithHour[1], '0', [timeWithHour[3]])
}

function formatMatchedTime(
  rawHour: string | undefined,
  rawMinute: string | undefined,
  rawPeriods: Array<string | undefined>,
): string | null {
  let hour = Number(rawHour)
  const minute = Number(rawMinute ?? '0')
  const period = rawPeriods.find((value) => Boolean(value))

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null
  }

  if (period === 'вечера' || period === 'дня') {
    if (hour >= 1 && hour <= 11) {
      hour += 12
    }
  }

  if (period === 'ночи' && hour === 12) {
    hour = 0
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null
  }

  return formatTimeKey(hour, minute)
}

function stripSchedulePhrases(value: string): string {
  return normalizeWhitespace(
    normalizeRussianText(value)
      .replace(/(?:^|\s)(?:сегодня|завтра|послезавтра)(?=$|\s)/gu, ' ')
      .replace(
        /(?:^|\s)(?:в|во|на|к)\s+(?:понедельник|понедельника|вторник|вторника|среду|среда|четверг|четверга|пятницу|пятница|субботу|суббота|воскресенье|воскресенья)(?=$|\s)/gu,
        ' ',
      )
      .replace(
        /(?:^|\s)(?:в|к|на)\s+\d{1,2}(?::|\s+)\d{1,2}(?:\s*(?:утра|дня|вечера|ночи))?(?=$|\s)/gu,
        ' ',
      )
      .replace(
        /(?:^|\s)(?:в|к|на)\s+\d{1,2}(?:(?:\s*час(?:а|ов)?)?(?:\s*(?:утра|дня|вечера|ночи))|\s*час(?:а|ов)?)(?=$|\s)/gu,
        ' ',
      ),
  )
}

function isPingCommand(
  command: string,
  originalUtterance: string | undefined,
): boolean {
  return (
    command === 'ping' ||
    normalizeRussianText(originalUtterance ?? '') === 'ping'
  )
}

function isExitCommand(command: string): boolean {
  return /^(?:выход|выйти|закончить|стоп|хватит|отмена|спасибо)$/u.test(command)
}

function isHelpCommand(command: string): boolean {
  return /^(?:помощь|помоги|что ты умеешь|что умеешь|что можно)$/u.test(command)
}

function getNormalizedCommand(value: string): string {
  return normalizeWhitespace(value).toLowerCase()
}

function normalizeRussianText(value: string): string {
  return normalizeWhitespace(value).toLowerCase().replaceAll('ё', 'е')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function findTargetWeekday(value: string): number | null {
  const weekdays: Array<[RegExp, number]> = [
    [/(?:^|\s)(?:в|во|на|к)\s+понедельник(?:а)?(?=$|\s)/u, 1],
    [/(?:^|\s)(?:в|во|на|к)\s+вторник(?:а)?(?=$|\s)/u, 2],
    [/(?:^|\s)(?:в|во|на|к)\s+сред(?:у|а)(?=$|\s)/u, 3],
    [/(?:^|\s)(?:в|во|на|к)\s+четверг(?:а)?(?=$|\s)/u, 4],
    [/(?:^|\s)(?:в|во|на|к)\s+пятниц(?:у|а)(?=$|\s)/u, 5],
    [/(?:^|\s)(?:в|во|на|к)\s+суббот(?:у|а)(?=$|\s)/u, 6],
    [/(?:^|\s)(?:в|во|на|к)\s+воскресень(?:е|я)(?=$|\s)/u, 0],
  ]

  for (const [pattern, weekday] of weekdays) {
    if (pattern.test(value)) {
      return weekday
    }
  }

  return null
}

function getDaysUntilWeekday(todayKey: string, targetWeekday: number): number {
  const { day, month, year } = parseDateKey(todayKey)
  const today = new Date(Date.UTC(year, month - 1, day))
  const todayWeekday = today.getUTCDay()
  const distance = (targetWeekday - todayWeekday + 7) % 7

  return distance === 0 ? 7 : distance
}

function resolveYearForMonthDay(
  todayKey: string,
  month: number,
  day: number,
): number {
  const {
    day: currentDay,
    month: currentMonth,
    year: currentYear,
  } = parseDateKey(todayKey)

  if (month < currentMonth || (month === currentMonth && day < currentDay)) {
    return currentYear + 1
  }

  return currentYear
}

function parseDateKey(dateKey: string): {
  day: number
  month: number
  year: number
} {
  const [year = 1970, month = 1, day = 1] = dateKey.split('-').map(Number)

  return { day, month, year }
}

function formatDateKey(year: number, month: number, day: number): string {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-')
}

function formatTimeKey(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function readInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value)
    ? value
    : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class ProviderBackedAliceCommandParser implements LlmAliceCommandParser {
  constructor(private readonly client: AliceCommandLlmClient) {}

  async parse(
    input: AliceCommandParserInput,
  ): Promise<AliceParsedCommand | null> {
    try {
      const outputText = await this.client.createCommandCompletion(input)

      if (!outputText) {
        return null
      }

      return normalizeLlmCommand(
        llmCommandSchema.parse(JSON.parse(outputText)),
        input,
      )
    } catch {
      return null
    }
  }
}

function createAliceCommandLlmClient(
  config: AliceCommandLlmConfig,
): AliceCommandLlmClient {
  switch (config.apiFormat) {
    case 'responses':
      return new ResponsesApiAliceCommandLlmClient(config)
    case 'chat_completions':
      return new ChatCompletionsAliceCommandLlmClient(config)
  }
}

class ResponsesApiAliceCommandLlmClient implements AliceCommandLlmClient {
  constructor(private readonly config: AliceCommandLlmConfig) {}

  async createCommandCompletion(
    input: AliceCommandParserInput,
  ): Promise<string | null> {
    const response = await this.createResponse(input)

    return readResponsesApiOutputText(response)
  }

  private async createResponse(
    input: AliceCommandParserInput,
  ): Promise<unknown> {
    const timeZone = normalizeTimeZone(input.timeZone)
    const todayKey = getDateKeyInTimeZone(new Date(), timeZone)
    const abortController = new AbortController()
    const timeoutId = setTimeout(
      () => abortController.abort(),
      this.config.timeoutMs,
    )

    try {
      const response = await fetch(this.config.endpoint, {
        body: JSON.stringify({
          input: [
            {
              content: ALICE_COMMAND_LLM_SYSTEM_PROMPT,
              role: 'system',
            },
            {
              content: createAliceCommandLlmUserContent(input, {
                timeZone,
                todayKey,
              }),
              role: 'user',
            },
          ],
          model: this.config.model,
          temperature: 0,
          text: {
            format: {
              name: 'alice_command_parse',
              schema: llmStructuredOutputSchema,
              strict: true,
              type: 'json_schema',
            },
          },
        }),
        headers: {
          ...createAliceCommandLlmHeaders(this.config),
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: abortController.signal,
      })

      if (!response.ok) {
        return null
      }

      return response.json()
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

class ChatCompletionsAliceCommandLlmClient implements AliceCommandLlmClient {
  constructor(private readonly config: AliceCommandLlmConfig) {}

  async createCommandCompletion(
    input: AliceCommandParserInput,
  ): Promise<string | null> {
    const timeZone = normalizeTimeZone(input.timeZone)
    const todayKey = getDateKeyInTimeZone(new Date(), timeZone)
    const abortController = new AbortController()
    const timeoutId = setTimeout(
      () => abortController.abort(),
      this.config.timeoutMs,
    )

    try {
      const response = await fetch(this.config.endpoint, {
        body: JSON.stringify({
          messages: [
            {
              content: ALICE_COMMAND_LLM_SYSTEM_PROMPT,
              role: 'system',
            },
            {
              content: createAliceCommandLlmUserContent(input, {
                timeZone,
                todayKey,
              }),
              role: 'user',
            },
          ],
          model: this.config.model,
          response_format: {
            json_schema: {
              name: 'alice_command_parse',
              schema: llmStructuredOutputSchema,
              strict: true,
            },
            type: 'json_schema',
          },
          temperature: 0,
        }),
        headers: {
          ...createAliceCommandLlmHeaders(this.config),
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: abortController.signal,
      })

      if (!response.ok) {
        return null
      }

      return readChatCompletionsOutputText(await response.json())
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

const ALICE_COMMAND_LLM_SYSTEM_PROMPT =
  'Ты классифицируешь русские голосовые команды для планера Chaotika. Верни только JSON по схеме. Не исполняй команды. Неиспользуемые поля заполняй null. Покупкой считай фразы про список покупок или намерение купить предметы. Задачей считай просьбу добавить дело, задачу или напоминание. Для запросов прочитать задачи верни list_tasks. Даты возвращай как YYYY-MM-DD в локальной дате пользователя, время как HH:MM.'

function createAliceCommandLlmUserContent(
  input: AliceCommandParserInput,
  context: { timeZone: string; todayKey: string },
): string {
  return JSON.stringify({
    command: input.command,
    timezone: context.timeZone,
    today: context.todayKey,
  })
}

function createAliceCommandLlmHeaders(
  config: AliceCommandLlmConfig,
): Record<string, string> {
  if (!config.apiKey) {
    return {}
  }

  const scheme = config.provider === 'yandex' ? 'Api-Key' : 'Bearer'

  return { authorization: `${scheme} ${config.apiKey}` }
}

function normalizeLlmCommand(
  command: z.infer<typeof llmCommandSchema>,
  input: AliceCommandParserInput,
): AliceParsedCommand {
  switch (command.intent) {
    case 'create_task': {
      if (!command.title) {
        return { confidence: 0, intent: 'unknown', source: 'llm' }
      }

      return {
        confidence: command.confidence,
        intent: 'create_task',
        plannedDate: command.planned_date,
        plannedEndTime: null,
        plannedStartTime: command.planned_start_time,
        reminderTimeZone: normalizeTimeZone(input.timeZone),
        source: 'llm',
        title: normalizeWhitespace(command.title),
      }
    }
    case 'add_shopping_item': {
      if (!command.text) {
        return { confidence: 0, intent: 'unknown', source: 'llm' }
      }

      return {
        confidence: command.confidence,
        intent: 'add_shopping_item',
        source: 'llm',
        text: normalizeWhitespace(command.text),
      }
    }
    case 'list_tasks': {
      if (!command.range) {
        return { confidence: 0, intent: 'unknown', source: 'llm' }
      }

      const timeZone = normalizeTimeZone(input.timeZone)
      const todayKey = getDateKeyInTimeZone(new Date(), timeZone)

      return {
        confidence: command.confidence,
        intent: 'list_tasks',
        plannedDate:
          command.range === 'today' ? todayKey : addDaysToDateKey(todayKey, 1),
        range: command.range,
        source: 'llm',
      }
    }
    case 'help':
      return { confidence: command.confidence, intent: 'help', source: 'llm' }
    case 'exit':
      return { confidence: command.confidence, intent: 'exit', source: 'llm' }
    case 'unknown':
      return {
        confidence: command.confidence,
        intent: 'unknown',
        source: 'llm',
      }
  }
}

function readResponsesApiOutputText(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  if (typeof value.output_text === 'string') {
    return value.output_text
  }

  if (!Array.isArray(value.output)) {
    return null
  }

  for (const outputItem of value.output) {
    if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) {
      continue
    }

    for (const contentItem of outputItem.content) {
      if (isRecord(contentItem) && typeof contentItem.text === 'string') {
        return contentItem.text
      }
    }
  }

  return null
}

function readChatCompletionsOutputText(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return null
  }

  for (const choice of value.choices) {
    if (!isRecord(choice) || !isRecord(choice.message)) {
      continue
    }

    const { content } = choice.message

    if (typeof content === 'string') {
      return content
    }

    if (!Array.isArray(content)) {
      continue
    }

    for (const contentItem of content) {
      if (isRecord(contentItem) && typeof contentItem.text === 'string') {
        return contentItem.text
      }
    }
  }

  return null
}
