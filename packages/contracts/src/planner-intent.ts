import { z } from 'zod'

export const plannerIntentNameSchema = z.enum([
  'create_task',
  'create_event',
  'create_reminder',
  'add_shopping_item',
  'reschedule',
  'delete',
  'clarify',
])

export const plannerIntentListSchema = z.enum([
  'home',
  'work',
  'kids',
  'garden',
  'shopping',
  'personal',
])

export const plannerIntentSchema = z.object({
  clarificationQuestion: z.string().optional(),
  confidence: z.number().min(0).max(1),
  datetime: z.string().optional(),
  intent: plannerIntentNameSchema,
  list: plannerIntentListSchema.optional(),
  needsConfirmation: z.boolean(),
  rawText: z.string(),
  reminderAt: z.string().optional(),
  title: z.string().optional(),
})

export type PlannerIntentName = z.infer<typeof plannerIntentNameSchema>
export type PlannerIntentList = z.infer<typeof plannerIntentListSchema>
export type PlannerIntent = z.infer<typeof plannerIntentSchema>

export interface PlannerIntentParserOptions {
  now?: Date
}

interface ParsedDateTime {
  value: string
}

const WAKE_WORD_PATTERN = /^хаотика[\s,.:;-]*/i
const DELETE_PATTERN = /(удали|удалить|сотри|стереть|убери|убрать|delete)/i
const RESCHEDULE_PATTERN =
  /(перенеси|перенести|перепланируй|перепланировать|сдвинь|сдвинуть)/i
const CHANGE_PATTERN = /(измени|изменить|поменяй|поменять)/i
const REMINDER_PATTERN = /(напомни|напомнить|напоминание)/i
const EVENT_PATTERN =
  /(создай\s+событие|добавь\s+событие|запланируй|встреча|событие)/i
const SHOPPING_PATTERN =
  /(список\s+покупок|покупки|покупок|в\s+покупки|купи|купить)/i
const TASK_PATTERN =
  /(создай\s+задачу|добавь\s+задачу|запиши\s+задачу|задача|надо|нужно)/i
const MASS_CHANGE_PATTERN = /(все|всё|каждую|каждый|массово|bulk)/i

export class PlannerIntentParser {
  parse(
    rawText: string,
    options: PlannerIntentParserOptions = {},
  ): PlannerIntent {
    const normalizedText = normalizeRawText(rawText)
    const commandText = stripWakeWord(normalizedText)
    const now = options.now ?? new Date()
    const parsedDateTime = parseDateTime(commandText, now)

    if (!commandText) {
      return createClarifyIntent(rawText, 'Что добавить в планер?')
    }

    if (DELETE_PATTERN.test(commandText)) {
      const title = extractTitle(commandText, [
        DELETE_PATTERN,
        MASS_CHANGE_PATTERN,
      ])

      return createIntent({
        clarificationQuestion: title
          ? undefined
          : 'Что именно удалить? Я попрошу подтверждение перед удалением.',
        confidence: title ? 0.72 : 0.52,
        intent: 'delete',
        needsConfirmation: true,
        rawText,
        title,
      })
    }

    if (
      RESCHEDULE_PATTERN.test(commandText) ||
      CHANGE_PATTERN.test(commandText)
    ) {
      const title = extractTitle(commandText, [
        RESCHEDULE_PATTERN,
        CHANGE_PATTERN,
      ])

      return createIntent({
        clarificationQuestion:
          title && parsedDateTime
            ? undefined
            : 'Что и на какое время перенести?',
        confidence: title && parsedDateTime ? 0.7 : 0.54,
        datetime: parsedDateTime?.value,
        intent: 'reschedule',
        needsConfirmation: true,
        rawText,
        title,
      })
    }

    if (REMINDER_PATTERN.test(commandText)) {
      const title = extractTitle(commandText, [REMINDER_PATTERN])

      return createIntent({
        clarificationQuestion:
          title && parsedDateTime ? undefined : 'О чем и когда напомнить?',
        confidence: title && parsedDateTime ? 0.82 : 0.56,
        intent: title && parsedDateTime ? 'create_reminder' : 'clarify',
        needsConfirmation: false,
        rawText,
        reminderAt: parsedDateTime?.value,
        title,
      })
    }

    if (isShoppingCommand(commandText)) {
      const title = extractTitle(commandText, [
        /(добавь|запиши|внеси|положи|купи|купить|надо|нужно)/i,
        /(в\s+список\s+покупок|список\s+покупок|в\s+покупки|покупки|покупок)/i,
      ])

      return createIntent({
        clarificationQuestion: title ? undefined : 'Что добавить в покупки?',
        confidence: title ? 0.78 : 0.5,
        intent: title ? 'add_shopping_item' : 'clarify',
        list: 'shopping',
        needsConfirmation: true,
        rawText,
        title,
      })
    }

    if (EVENT_PATTERN.test(commandText)) {
      const title = extractTitle(commandText, [EVENT_PATTERN])

      return createIntent({
        clarificationQuestion:
          title && parsedDateTime
            ? undefined
            : 'Какое событие и когда создать?',
        confidence: title && parsedDateTime ? 0.76 : 0.58,
        datetime: parsedDateTime?.value,
        intent: title && parsedDateTime ? 'create_event' : 'clarify',
        list: detectPlannerList(commandText),
        needsConfirmation: true,
        rawText,
        title,
      })
    }

    if (TASK_PATTERN.test(commandText)) {
      const title = extractTitle(commandText, [TASK_PATTERN])

      return createIntent({
        clarificationQuestion: title ? undefined : 'Какую задачу создать?',
        confidence: title ? 0.74 : 0.5,
        datetime: parsedDateTime?.value,
        intent: title ? 'create_task' : 'clarify',
        list: detectPlannerList(commandText),
        needsConfirmation: true,
        rawText,
        title,
      })
    }

    return createClarifyIntent(
      rawText,
      'Не понял команду. Создать задачу, событие, напоминание или покупку?',
    )
  }
}

export type VoiceAssistantSource =
  | 'android_microphone'
  | 'android_wake_word'
  | 'web_microphone'

export type VoiceAssistantStatus =
  | 'idle'
  | 'wake_listening'
  | 'recording'
  | 'transcribing'
  | 'parsing'
  | 'awaiting_confirmation'
  | 'executing'
  | 'completed'
  | 'error'

export type VoiceAssistantState =
  | {
      status: 'idle' | 'wake_listening'
    }
  | {
      source: VoiceAssistantSource
      status: 'recording' | 'transcribing'
    }
  | {
      source: VoiceAssistantSource
      status: 'parsing'
      transcript: string
    }
  | {
      intent: PlannerIntent
      source: VoiceAssistantSource
      status: 'awaiting_confirmation' | 'executing' | 'completed'
      transcript: string
    }
  | {
      error: string
      source?: VoiceAssistantSource
      status: 'error'
      transcript?: string
    }

export type VoiceAssistantEvent =
  | { type: 'start_wake_word' }
  | { source: VoiceAssistantSource; type: 'recording_started' }
  | {
      source: VoiceAssistantSource
      transcript: string
      type: 'transcript_received'
    }
  | { intent: PlannerIntent; type: 'intent_parsed' }
  | { type: 'confirmed' }
  | { type: 'executed' }
  | { type: 'cancelled' }
  | {
      error: string
      source?: VoiceAssistantSource
      transcript?: string
      type: 'failed'
    }

export const initialVoiceAssistantState: VoiceAssistantState = {
  status: 'idle',
}

export function reduceVoiceAssistantState(
  state: VoiceAssistantState,
  event: VoiceAssistantEvent,
): VoiceAssistantState {
  switch (event.type) {
    case 'start_wake_word':
      return { status: 'wake_listening' }
    case 'recording_started':
      return {
        source: event.source,
        status: 'recording',
      }
    case 'transcript_received':
      return {
        source: event.source,
        status: 'parsing',
        transcript: event.transcript,
      }
    case 'intent_parsed':
      if (state.status !== 'parsing') {
        return state
      }

      return {
        intent: event.intent,
        source: state.source,
        status: 'awaiting_confirmation',
        transcript: state.transcript,
      }
    case 'confirmed':
      if (state.status !== 'awaiting_confirmation') {
        return state
      }

      return {
        ...state,
        status: 'executing',
      }
    case 'executed':
      if (
        state.status !== 'executing' &&
        state.status !== 'awaiting_confirmation'
      ) {
        return state
      }

      return {
        ...state,
        status: 'completed',
      }
    case 'cancelled':
      return initialVoiceAssistantState
    case 'failed':
      return createErrorState(event)
  }
}

function normalizeRawText(rawText: string): string {
  return rawText.replace(/\s+/g, ' ').trim()
}

function stripWakeWord(text: string): string {
  return text.replace(WAKE_WORD_PATTERN, '').trim()
}

function isShoppingCommand(text: string): boolean {
  if (!SHOPPING_PATTERN.test(text)) {
    return false
  }

  return !/задач[ауи]?/i.test(text) || /(список|покупки|покупок)/i.test(text)
}

function createClarifyIntent(
  rawText: string,
  clarificationQuestion: string,
): PlannerIntent {
  return createIntent({
    clarificationQuestion,
    confidence: 0.32,
    intent: 'clarify',
    needsConfirmation: false,
    rawText,
  })
}

function createIntent(input: {
  clarificationQuestion?: string | undefined
  confidence: number
  datetime?: string | undefined
  intent: PlannerIntentName
  list?: PlannerIntentList | undefined
  needsConfirmation: boolean
  rawText: string
  reminderAt?: string | undefined
  title?: string | undefined
}): PlannerIntent {
  return plannerIntentSchema.parse(removeUndefinedProperties(input))
}

function removeUndefinedProperties<T extends Record<string, unknown>>(
  value: T,
): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T
}

function detectPlannerList(text: string): PlannerIntentList | undefined {
  if (/(дом|дома|домашн)/i.test(text)) {
    return 'home'
  }

  if (/(работ|рабоч)/i.test(text)) {
    return 'work'
  }

  if (/(дети|детск|ребен|ребён)/i.test(text)) {
    return 'kids'
  }

  if (/(сад|огород|дач)/i.test(text)) {
    return 'garden'
  }

  if (/(личн|персональн)/i.test(text)) {
    return 'personal'
  }

  return undefined
}

function extractTitle(
  text: string,
  commandPatterns: RegExp[],
): string | undefined {
  let title = text

  for (const pattern of commandPatterns) {
    title = title.replace(pattern, ' ')
  }

  title = title
    .replace(WAKE_WORD_PATTERN, ' ')
    .replace(/(^|\s)(мне|пожалуйста|плиз|на)(?=\s|$)/gi, ' ')
    .replace(/(^|\s)(сегодня|завтра|послезавтра)(?=\s|$)/gi, ' ')
    .replace(/(^|\s)(утром|вечером|днем|днём|ночью)(?=\s|$)/gi, ' ')
    .replace(
      /(^|\s)(в|к)\s+\d{1,2}(?::\d{2})?\s*(?:час(?:ов|а)?|утра|вечера|дня|ночи)?(?=\s|$)/gi,
      ' ',
    )
    .replace(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g, ' ')
    .replace(/[,:;.!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return title || undefined
}

function parseDateTime(text: string, now: Date): ParsedDateTime | undefined {
  const date = parseDate(text, now)
  const time = parseTime(text)

  if (!date && !time) {
    return undefined
  }

  const resolvedDate = date ?? formatDateKey(now)

  return {
    value: time ? `${resolvedDate}T${time}` : resolvedDate,
  }
}

function parseDate(text: string, now: Date): string | undefined {
  if (/(^|\s)сегодня(?=\s|$)/i.test(text)) {
    return formatDateKey(now)
  }

  if (/(^|\s)послезавтра(?=\s|$)/i.test(text)) {
    return formatDateKey(addDays(now, 2))
  }

  if (/(^|\s)завтра(?=\s|$)/i.test(text)) {
    return formatDateKey(addDays(now, 1))
  }

  const numericDateMatch =
    /\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/.exec(text)

  if (!numericDateMatch) {
    return undefined
  }

  const day = Number(numericDateMatch[1])
  const month = Number(numericDateMatch[2])
  const yearText = numericDateMatch[3]
  const currentYear = now.getFullYear()
  const year = yearText
    ? Number(yearText.length === 2 ? `20${yearText}` : yearText)
    : currentYear

  if (!isValidDateParts(year, month, day)) {
    return undefined
  }

  return formatDateParts(year, month, day)
}

function parseTime(text: string): string | undefined {
  const timeMatch =
    /(?:^|\s)(?:в|к|на)\s*(\d{1,2})(?::(\d{2}))?\s*(час(?:ов|а)?|утра|вечера|дня|ночи)?(?=\s|$)/i.exec(
      text,
    )

  if (!timeMatch) {
    return undefined
  }

  let hours = Number(timeMatch[1])
  const minutes = timeMatch[2] ? Number(timeMatch[2]) : 0
  const period = timeMatch[3]?.toLowerCase()

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return undefined
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return undefined
  }

  if ((period === 'вечера' || period === 'дня') && hours < 12) {
    hours += 12
  }

  if (period === 'ночи' && hours === 12) {
    hours = 0
  }

  return `${pad2(hours)}:${pad2(minutes)}`
}

function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + days)

  return nextDate
}

function formatDateKey(date: Date): string {
  return formatDateParts(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  )
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day)

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function createErrorState(
  event: Extract<VoiceAssistantEvent, { type: 'failed' }>,
): VoiceAssistantState {
  return {
    error: event.error,
    status: 'error',
    ...(event.source ? { source: event.source } : {}),
    ...(event.transcript ? { transcript: event.transcript } : {}),
  }
}
