import { z } from 'zod'

export const plannerIntentNameSchema = z.enum([
  'create_task',
  'add_shopping_item',
  'reschedule_task',
  'get_agenda',
  'clarify',
  'unsupported',
])

export const plannerIntentDatePrecisionSchema = z.enum([
  'exact',
  'date_only',
  'period',
  'relative',
  'unknown',
])

export const plannerIntentPrioritySchema = z.enum(['low', 'normal', 'high'])

export const plannerIntentRecurrenceFrequencySchema = z.enum([
  'daily',
  'weekly',
  'monthly',
  'yearly',
])

export const plannerIntentListSchema = z.enum([
  'home',
  'work',
  'kids',
  'garden',
  'shopping',
  'personal',
])

export const plannerIntentItemSchema = z.object({
  quantity: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
})

export const plannerIntentRecurrenceSchema = z.object({
  frequency: plannerIntentRecurrenceFrequencySchema,
  interval: z.number().int().positive().optional(),
  until: z.string().optional(),
})

export const plannerIntentSchema = z
  .object({
    alternatives: z.array(z.string().trim().min(1)).optional(),
    clarificationQuestion: z.string().trim().min(1).optional(),
    confidence: z.number().min(0).max(1),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .optional(),
    datePrecision: plannerIntentDatePrecisionSchema.optional(),
    dateText: z.string().trim().min(1).optional(),
    intent: plannerIntentNameSchema,
    isDangerous: z.boolean().optional(),
    items: z.array(plannerIntentItemSchema).min(1).optional(),
    needsConfirmation: z.boolean(),
    priority: plannerIntentPrioritySchema.optional(),
    rawText: z.string(),
    recurrence: plannerIntentRecurrenceSchema.optional(),
    reminderAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u)
      .optional(),
    requiresUnlock: z.boolean().optional(),
    sphereConfidence: z.number().min(0).max(1).optional(),
    sphereId: z.string().trim().min(1).optional(),
    targetQuery: z.string().trim().min(1).optional(),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/u)
      .optional(),
    title: z.string().trim().min(1).optional(),
    transcript: z.string().trim().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.intent === 'create_task' && !value.title) {
      context.addIssue({
        code: 'custom',
        message: 'create_task requires title.',
        path: ['title'],
      })
    }

    if (value.intent === 'add_shopping_item' && !value.items?.length) {
      context.addIssue({
        code: 'custom',
        message: 'add_shopping_item requires items.',
        path: ['items'],
      })
    }

    if (value.intent === 'reschedule_task' && !value.targetQuery) {
      context.addIssue({
        code: 'custom',
        message: 'reschedule_task requires targetQuery.',
        path: ['targetQuery'],
      })
    }

    if (value.intent === 'get_agenda' && !value.date) {
      context.addIssue({
        code: 'custom',
        message: 'get_agenda requires date.',
        path: ['date'],
      })
    }
  })

export type PlannerIntentName = z.infer<typeof plannerIntentNameSchema>
export type PlannerIntentList = z.infer<typeof plannerIntentListSchema>
export type PlannerIntentDatePrecision = z.infer<
  typeof plannerIntentDatePrecisionSchema
>
export type PlannerIntent = z.infer<typeof plannerIntentSchema>
export type PlannerIntentItem = z.infer<typeof plannerIntentItemSchema>
export type PlannerIntentRecurrence = z.infer<
  typeof plannerIntentRecurrenceSchema
>

export type PlannerIntentParserSource =
  | 'android_wake_word'
  | 'android_push_to_talk'
  | 'web_push_to_talk'
  | 'backend_text'

export interface PlannerIntentParserSphere {
  id: string
  keywords?: string[] | undefined
  name: string
}

export interface PlannerIntentParserContext {
  appRole?: 'owner' | 'test' | 'admin' | 'user' | 'guest' | undefined
  featureGateRole?: 'owner' | 'test' | 'admin' | 'user' | 'guest' | undefined
  isDeviceLocked?: boolean | undefined
  locale?: 'ru-RU' | undefined
  now?: Date | string | undefined
  source?: PlannerIntentParserSource | undefined
  spheres?: PlannerIntentParserSphere[] | undefined
  timezone?: string | undefined
}

export type PlannerIntentParserOptions = PlannerIntentParserContext

interface RuntimeParserContext extends PlannerIntentParserContext {
  locale: 'ru-RU'
  now: Date
  spheres: PlannerIntentParserSphere[]
  timezone: string
}

interface DateTimeParseResult {
  ambiguousTime: boolean
  date?: string | undefined
  datePrecision?: PlannerIntentDatePrecision | undefined
  dateText?: string | undefined
  hasExactRelativeReminder: boolean
  hasRelativeReminder: boolean
  reminderAt?: string | undefined
  time?: string | undefined
}

interface SphereResolution {
  sphereConfidence: number
  sphereId: string
}

interface RecurrenceParseResult {
  recurrence?: PlannerIntentRecurrence | undefined
}

const WAKE_WORD_PATTERN = /^хаотика[\s,.:;!-]*/iu
const DELETE_PATTERN =
  /(?:^|\s)(?:удали|удалить|сотри|стереть|удаление|delete)(?=\s|$)|(?:^|\s)(?:убери|убрать)\s+(?:все|всё|задач[ауи]?|дела|план)(?=\s|$)/iu
const RESCHEDULE_PATTERN =
  /(?:^|\s)(перенеси|перенести|перепланируй|перепланировать|сдвинь|сдвинуть)(?=\s|$)/iu
const AGENDA_PATTERN =
  /(?:^|\s)(что\s+у\s+меня|какие\s+задачи|что\s+запланировано|покажи\s+(?:план|задачи|расписание)|план\s+на)(?=\s|$)/iu
const TASK_PREFIX_PATTERN =
  /(?:^|\s)(создай|создать|добавь|добавить|запиши|записать|внеси|внести|поставь|поставить|запланируй|запланировать)\s+(?:мне\s+)?(?:задачу|дело)?(?=\s|$)/giu
const REMIND_PREFIX_PATTERN =
  /(?:^|\s)(напомни|напомнить|напоминание)(?=\s|$)/giu
const TASK_MARKER_PATTERN =
  /(?:^|\s)(задач[ауи]?|дело|надо|нужно|запланируй|запланировать|поставь|поставить|запиши|записать|создай|создать|добавь|добавить|напомни|напомнить)(?=\s|$)/iu
const EXPLICIT_SHOPPING_PATTERN =
  /(?:^|\s)(в\s+покупки|в\s+список\s+покупок|список\s+покупок|покупки|покупок)(?=\s|$)/iu
const BUY_PREFIX_PATTERN = /^(?:мне\s+)?(?:купи|купить)(?=\s|$)/iu
const BUY_INTENT_PATTERN =
  /^(?:мне\s+)?(?:(?:надо|нужно)\s+(?:бы\s+)?)?(?:купи|купить)(?=\s|$)/iu
const BUY_WORD_PATTERN = /(?:^|\s)(купи|купить)(?=\s|$)/iu
const WEEKDAY_INDEX: Record<string, number> = {
  воскресенье: 0,
  воскресенье2: 0,
  воскресенья: 0,
  понедельник: 1,
  понедельника: 1,
  понедельникам: 1,
  вторник: 2,
  вторника: 2,
  вторникам: 2,
  среда: 3,
  среду: 3,
  средам: 3,
  четверг: 4,
  четверга: 4,
  четвергам: 4,
  пятница: 5,
  пятницу: 5,
  пятницам: 5,
  суббота: 6,
  субботу: 6,
  субботам: 6,
}

const WEEKDAY_PATTERN =
  /(?:^|\s)(?:в|во|на)?\s*(следующ(?:ий|ую|ее|ей)\s+)?(понедельник|понедельника|вторник|вторника|среду|среда|четверг|четверга|пятницу|пятница|субботу|суббота|воскресенье|воскресенья)(?=\s|$)/iu

const NUMBER_WORDS: Record<string, number> = {
  ноль: 0,
  одну: 1,
  одна: 1,
  один: 1,
  одно: 1,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  одиннадцать: 11,
  двенадцать: 12,
  тринадцать: 13,
  четырнадцать: 14,
  пятнадцать: 15,
  шестнадцать: 16,
  семнадцать: 17,
  восемнадцать: 18,
  девятнадцать: 19,
  двадцать: 20,
  тридцать: 30,
  сорок: 40,
  пятьдесят: 50,
}

const GROCERY_WORDS = new Set([
  'батон',
  'вода',
  'гречка',
  'йогурт',
  'кефир',
  'кофе',
  'курица',
  'масло',
  'молоко',
  'молока',
  'морковь',
  'мясо',
  'мыло',
  'овощи',
  'огурцы',
  'рис',
  'рыба',
  'сахар',
  'соль',
  'сыр',
  'творог',
  'хлеб',
  'чай',
  'яблоки',
  'яблок',
  'яйца',
])

const SHOPPING_TITLE_NORMALIZATION: Record<string, string> = {
  молока: 'молоко',
}

const BUILT_IN_SPHERE_KEYWORDS: Record<string, string[]> = {
  дети: [
    'кирилл',
    'максим',
    'ребенок',
    'ребенка',
    'дети',
    'детский',
    'школа',
    'английский',
    'садик',
  ],
  дом: ['дом', 'дома', 'окна', 'кухня', 'уборка', 'плиту', 'духовку', 'посуду'],
  финансы: ['оплата', 'оплатить', 'счет', 'налог', 'банк', 'кредит'],
  работа: [
    'работа',
    'рабочий',
    'созвон',
    'проект',
    'код',
    'релиз',
    'документы',
  ],
  сад: [
    'сад',
    'огород',
    'дача',
    'рассада',
    'рассаду',
    'грунт',
    'теплица',
    'полить',
  ],
  здоровье: ['врач', 'врачу', 'стоматолог', 'аптека', 'анализы'],
  покупки: ['купить', 'купи', 'молоко', 'хлеб', 'яйца', 'магазин'],
}

export class PlannerIntentParser {
  parse(
    rawText: string,
    context: PlannerIntentParserOptions = {},
  ): PlannerIntent {
    const runtimeContext = createRuntimeContext(context)
    const normalizedText = VoiceTextNormalizer.normalize(rawText)
    const commandText = VoiceTextNormalizer.stripWakeWord(normalizedText)
    const dateTime = DateTimeParser.parse(commandText, runtimeContext)

    if (!commandText) {
      return createClarifyIntent(rawText, 'Что добавить в планер?')
    }

    if (DELETE_PATTERN.test(commandText)) {
      return createIntent({
        clarificationQuestion: 'Удаление голосом пока не поддерживается.',
        confidence: 0.72,
        intent: 'unsupported',
        isDangerous: true,
        needsConfirmation: true,
        rawText,
        requiresUnlock: runtimeContext.isDeviceLocked ? true : undefined,
      })
    }

    const agendaIntent = AgendaQueryParser.parse(
      rawText,
      commandText,
      runtimeContext,
    )

    if (agendaIntent) {
      return agendaIntent
    }

    const rescheduleIntent = RescheduleParser.parse(
      rawText,
      commandText,
      dateTime,
      runtimeContext,
    )

    if (rescheduleIntent) {
      return rescheduleIntent
    }

    const shoppingIntent = ShoppingItemsParser.parseIntent(
      rawText,
      commandText,
      dateTime,
    )

    if (shoppingIntent) {
      return shoppingIntent
    }

    return TaskIntentParser.parse(
      rawText,
      commandText,
      dateTime,
      runtimeContext,
    )
  }
}

export class VoiceTextNormalizer {
  static normalize(rawText: string): string {
    return rawText
      .toLocaleLowerCase('ru-RU')
      .replace(/ё/gu, 'е')
      .replace(/[“”"«»]/gu, '')
      .replace(/[?!]+/gu, ' ')
      .replace(/[,;]+/gu, ' ')
      .replace(/\s*([.:])\s*/gu, '$1')
      .replace(/(?:^|\s)пол\s*часа(?=\s|$)/gu, ' 30 минут')
      .replace(/(?:^|\s)полчаса(?=\s|$)/gu, ' 30 минут')
      .replace(/(?:^|\s)часик(?=\s|$)/gu, ' 1 час')
      .replace(/(?:^|\s)часика(?=\s|$)/gu, ' 1 часа')
      .replace(/\s+/gu, ' ')
      .trim()
      .replace(
        /(?:^|\s)([а-я]+(?:надцать|дцать|ок)?)(?=\s|$)/gu,
        (match: string, word: string) =>
          `${match.startsWith(' ') ? ' ' : ''}${
            NUMBER_WORDS[word] === undefined ? word : String(NUMBER_WORDS[word])
          }`,
      )
      .replace(/\s+/gu, ' ')
      .trim()
  }

  static stripWakeWord(text: string): string {
    return text.replace(WAKE_WORD_PATTERN, '').trim()
  }
}

class AgendaQueryParser {
  static parse(
    rawText: string,
    commandText: string,
    context: RuntimeParserContext,
  ): PlannerIntent | null {
    if (!AGENDA_PATTERN.test(commandText)) {
      return null
    }

    const dateTime = DateTimeParser.parse(commandText, context)
    const date = dateTime.date ?? formatDateKey(context.now)

    return createIntent({
      confidence: dateTime.date ? 0.95 : 0.82,
      date,
      datePrecision: dateTime.datePrecision ?? 'exact',
      dateText: dateTime.dateText,
      intent: 'get_agenda',
      needsConfirmation: false,
      rawText,
      requiresUnlock: context.isDeviceLocked ? true : undefined,
    })
  }
}

class RescheduleParser {
  static parse(
    rawText: string,
    commandText: string,
    dateTime: DateTimeParseResult,
    context: RuntimeParserContext,
  ): PlannerIntent | null {
    if (!RESCHEDULE_PATTERN.test(commandText)) {
      return null
    }

    const targetQuery = TaskTitleExtractor.extract(commandText, {
      dateTime,
      extraPatterns: [RESCHEDULE_PATTERN, /(?:^|\s)на(?=\s|$)/giu],
      removeBuyWords: false,
    })

    if (!targetQuery || !dateTime.date) {
      return createIntent({
        clarificationQuestion: 'Что и на какую дату перенести?',
        confidence: 0.54,
        intent: 'clarify',
        needsConfirmation: false,
        rawText,
      })
    }

    return createIntent({
      confidence: dateTime.ambiguousTime ? 0.72 : 0.85,
      date: dateTime.date,
      datePrecision: dateTime.ambiguousTime
        ? 'unknown'
        : (dateTime.datePrecision ?? 'date_only'),
      dateText: dateTime.dateText,
      intent: 'reschedule_task',
      isDangerous: true,
      needsConfirmation: true,
      rawText,
      requiresUnlock: context.isDeviceLocked ? true : undefined,
      targetQuery,
      time: dateTime.time,
      ...(dateTime.ambiguousTime
        ? { clarificationQuestion: 'В 8 утра или вечера?' }
        : {}),
    })
  }
}

class ShoppingItemsParser {
  static parseIntent(
    rawText: string,
    commandText: string,
    dateTime: DateTimeParseResult,
  ): PlannerIntent | null {
    if (!isShoppingCommand(commandText, dateTime)) {
      return null
    }

    const items = this.parseItems(commandText)

    if (!items.length) {
      return createIntent({
        clarificationQuestion: 'Что добавить в покупки?',
        confidence: 0.5,
        intent: 'clarify',
        needsConfirmation: false,
        rawText,
      })
    }

    const hasAmbiguity = items.some((item) => item.title.length <= 1)

    return createIntent({
      confidence: hasAmbiguity ? 0.72 : 0.94,
      intent: 'add_shopping_item',
      items,
      needsConfirmation: hasAmbiguity,
      rawText,
      requiresUnlock: false,
    })
  }

  static parseItems(commandText: string): PlannerIntentItem[] {
    let text = commandText
      .replace(
        /(?:^|\s)(добавь|добавить|запиши|записать|внеси|внести|положи|положить|купи|купить|надо|нужно)(?=\s|$)/giu,
        ' ',
      )
      .replace(
        /(?:^|\s)(в\s+список\s+покупок|список\s+покупок|в\s+покупки|покупки|покупок)(?=\s|$)/giu,
        ' ',
      )
      .replace(/(?:^|\s)мне(?=\s|$)/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()

    text = TaskTitleExtractor.removeDateTimeTokens(text).trim()

    if (!text) {
      return []
    }

    const roughParts = text
      .split(/\s*,\s*|\s+и\s+/gu)
      .flatMap((part) => splitKnownShoppingWords(part))
      .map((part) => normalizeShoppingItem(part))
      .filter((part): part is PlannerIntentItem => part !== null)

    return dedupeItems(roughParts)
  }
}

class TaskIntentParser {
  static parse(
    rawText: string,
    commandText: string,
    dateTime: DateTimeParseResult,
    context: RuntimeParserContext,
  ): PlannerIntent {
    const hasTaskSignal =
      TASK_MARKER_PATTERN.test(commandText) ||
      Boolean(dateTime.date || dateTime.time || dateTime.reminderAt) ||
      BUY_WORD_PATTERN.test(commandText)

    if (!hasTaskSignal) {
      return createIntent({
        clarificationQuestion:
          'Пока я умею создавать задачи, добавлять покупки, переносить задачи и показывать план на сегодня или завтра.',
        confidence: 0.4,
        intent: 'unsupported',
        needsConfirmation: false,
        rawText,
      })
    }

    const title = TaskTitleExtractor.extract(commandText, {
      dateTime,
      extraPatterns: [TASK_PREFIX_PATTERN, REMIND_PREFIX_PATTERN],
      removeBuyWords: false,
    })

    if (!title) {
      return createClarifyIntent(rawText, 'Какую задачу создать?')
    }

    const recurrence = RecurrenceParser.parse(commandText)
    const sphere = SphereResolver.resolve(title, context.spheres)
    const confidence = ConfidenceScorer.scoreTask(commandText, dateTime, title)
    const needsConfirmation = SafetyIntentMarker.needsTaskConfirmation(
      dateTime,
      confidence,
    )

    return createIntent({
      confidence,
      date: dateTime.date,
      datePrecision: getTaskDatePrecision(dateTime),
      dateText: dateTime.dateText,
      intent: 'create_task',
      needsConfirmation,
      rawText,
      recurrence: recurrence.recurrence,
      reminderAt: dateTime.reminderAt,
      sphereConfidence: sphere?.sphereConfidence,
      sphereId: sphere?.sphereId,
      time: dateTime.time,
      title,
      ...(dateTime.ambiguousTime
        ? { clarificationQuestion: 'В 8 утра или вечера?' }
        : {}),
    })
  }
}

class DateTimeParser {
  static parse(
    commandText: string,
    context: RuntimeParserContext,
  ): DateTimeParseResult {
    const relativeReminder = parseRelativeReminder(commandText, context.now)

    if (relativeReminder) {
      return relativeReminder
    }

    const date = parseDate(commandText, context.now)
    const time = parseTime(commandText)
    const approximateTime = parseApproximateTime(commandText)
    const finalTime = time?.time ?? approximateTime?.time
    const hasTime = Boolean(finalTime)
    const resolvedDate =
      date?.date ?? (hasTime ? formatDateKey(context.now) : undefined)

    return {
      ambiguousTime: time?.ambiguous ?? false,
      date: resolvedDate,
      datePrecision: resolveDatePrecision(date, time, approximateTime),
      dateText: joinText(date?.dateText, approximateTime?.dateText),
      hasExactRelativeReminder: false,
      hasRelativeReminder: false,
      time: finalTime,
    }
  }
}

function getTaskDatePrecision(
  dateTime: DateTimeParseResult,
): PlannerIntentDatePrecision | undefined {
  if (
    dateTime.date &&
    !dateTime.time &&
    dateTime.datePrecision !== 'period' &&
    dateTime.datePrecision !== 'unknown'
  ) {
    return 'date_only'
  }

  return (
    dateTime.datePrecision ??
    (dateTime.date && dateTime.time ? 'exact' : undefined)
  )
}

class TaskTitleExtractor {
  static extract(
    commandText: string,
    options: {
      dateTime: DateTimeParseResult
      extraPatterns?: RegExp[] | undefined
      removeBuyWords: boolean
    },
  ): string | undefined {
    let title = commandText

    for (const pattern of options.extraPatterns ?? []) {
      title = title.replace(pattern, ' ')
    }

    if (options.removeBuyWords) {
      title = title.replace(BUY_WORD_PATTERN, ' ')
    }

    title = this.removeDateTimeTokens(title)
      .replace(/(?:^|\s)(мне|пожалуйста|плиз)(?=\s|$)/giu, ' ')
      .replace(/(?:^|\s)(задачу|задача|дело|надо|нужно)(?=\s|$)/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()

    if (options.dateTime.datePrecision === 'period') {
      title = title
        .replace(/(?:^|\s)как-нибудь(?=\s|$)/giu, ' ')
        .replace(/\s+/gu, ' ')
    }

    return title || undefined
  }

  static removeDateTimeTokens(text: string): string {
    return text
      .replace(/(?:^|\s)(сегодня|завтра|послезавтра)(?=\s|$)/giu, ' ')
      .replace(/(?:^|\s)на\s+следующ(?:ей|ую)\s+недел[ею](?=\s|$)/giu, ' ')
      .replace(WEEKDAY_PATTERN, ' ')
      .replace(
        /(?:^|\s)через\s+\d+\s+(?:минуту|минуты|минут|час|часа|часов|день|дня|дней)(?=\s|$)/giu,
        ' ',
      )
      .replace(
        /(?:^|\s)(?:в|к)\s*\d{1,2}(?::\d{2})?\s*(?:час(?:ов|а)?\s*)?(?:утра|вечера|дня|ночи)?(?=\s|$)/giu,
        ' ',
      )
      .replace(/(?:^|\s)(утром|вечером|днем|ночью)(?=\s|$)/giu, ' ')
      .replace(/(?:^|\s)\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?(?=\s|$)/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
  }
}

class RecurrenceParser {
  static parse(commandText: string): RecurrenceParseResult {
    if (/(?:^|\s)по\s+будням(?=\s|$)/iu.test(commandText)) {
      return { recurrence: { frequency: 'weekly', interval: 1 } }
    }

    if (/(?:^|\s)кажд(?:ый|ую|ое)(?=\s|$)/iu.test(commandText)) {
      return { recurrence: { frequency: 'weekly', interval: 1 } }
    }

    return {}
  }
}

class SphereResolver {
  static resolve(
    title: string,
    spheres: PlannerIntentParserSphere[],
  ): SphereResolution | undefined {
    if (!spheres.length) {
      return undefined
    }

    const normalizedTitle = VoiceTextNormalizer.normalize(title)
    let best: SphereResolution | undefined

    for (const sphere of spheres) {
      const normalizedName = VoiceTextNormalizer.normalize(sphere.name)
      const keywords = [
        normalizedName,
        ...(sphere.keywords ?? []).map((keyword) =>
          VoiceTextNormalizer.normalize(keyword),
        ),
        ...(BUILT_IN_SPHERE_KEYWORDS[normalizedName] ?? []),
      ]
      const matchedKeywords = keywords.filter((keyword) =>
        containsWord(normalizedTitle, keyword),
      )

      if (!matchedKeywords.length) {
        continue
      }

      const confidence = Math.min(0.95, 0.62 + matchedKeywords.length * 0.12)

      if (!best || confidence > best.sphereConfidence) {
        best = {
          sphereConfidence: confidence,
          sphereId: sphere.id,
        }
      }
    }

    return best && best.sphereConfidence >= 0.62 ? best : undefined
  }
}

class SafetyIntentMarker {
  static needsTaskConfirmation(
    dateTime: DateTimeParseResult,
    confidence: number,
  ): boolean {
    if (
      dateTime.reminderAt &&
      dateTime.hasExactRelativeReminder &&
      confidence >= 0.85 &&
      !dateTime.ambiguousTime
    ) {
      return false
    }

    return true
  }
}

class ConfidenceScorer {
  static scoreTask(
    commandText: string,
    dateTime: DateTimeParseResult,
    title: string,
  ): number {
    let confidence = TASK_MARKER_PATTERN.test(commandText) ? 0.86 : 0.82

    if (dateTime.reminderAt && dateTime.hasExactRelativeReminder) {
      confidence = 0.95
    } else if (dateTime.date && dateTime.time) {
      confidence = 0.9
    } else if (dateTime.date) {
      confidence = 0.86
    }

    if (dateTime.datePrecision === 'period') {
      confidence -= 0.08
    }

    if (dateTime.ambiguousTime) {
      confidence -= 0.14
    }

    if (title.length < 3) {
      confidence -= 0.2
    }

    return clampConfidence(confidence)
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

export function canUseVoiceAssistant(
  appRole: 'owner' | 'test' | 'admin' | 'user' | 'guest' | null | undefined,
): boolean {
  return appRole === 'owner' || appRole === 'test'
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

export function validatePlannerIntent(value: unknown): PlannerIntent {
  return plannerIntentSchema.parse(value)
}

function createRuntimeContext(
  context: PlannerIntentParserOptions,
): RuntimeParserContext {
  return {
    ...context,
    locale: context.locale ?? 'ru-RU',
    now: normalizeNow(context.now),
    spheres: context.spheres ?? [],
    timezone: context.timezone ?? 'Europe/Moscow',
  }
}

function normalizeNow(now: Date | string | undefined): Date {
  if (now instanceof Date) {
    return Number.isNaN(now.getTime()) ? new Date() : new Date(now)
  }

  if (typeof now === 'string') {
    const parsed = new Date(now)

    return Number.isNaN(parsed.getTime()) ? new Date() : parsed
  }

  return new Date()
}

function isShoppingCommand(
  commandText: string,
  dateTime: DateTimeParseResult,
): boolean {
  if (EXPLICIT_SHOPPING_PATTERN.test(commandText)) {
    return true
  }

  if (
    (BUY_PREFIX_PATTERN.test(commandText) ||
      BUY_INTENT_PATTERN.test(commandText)) &&
    !dateTime.date
  ) {
    return true
  }

  if (
    /^(?:добавь|добавить|запиши|записать)(?=\s|$)/iu.test(commandText) &&
    !/(?:^|\s)задач[ауи]?(?=\s|$)/iu.test(commandText) &&
    !dateTime.date
  ) {
    return hasGroceryWord(commandText)
  }

  return false
}

function hasGroceryWord(text: string): boolean {
  return text
    .split(/\s+/gu)
    .some((word) => GROCERY_WORDS.has(normalizeShoppingWord(word)))
}

function splitKnownShoppingWords(text: string): string[] {
  const words = text.split(/\s+/gu).filter(Boolean)

  if (words.length <= 1) {
    return [text]
  }

  if (words.every((word) => GROCERY_WORDS.has(normalizeShoppingWord(word)))) {
    return words
  }

  return [text]
}

function normalizeShoppingItem(text: string): PlannerIntentItem | null {
  const cleaned = text
    .replace(/(?:^|\s)(и|а|еще|ещё)(?=\s|$)/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

  if (!cleaned) {
    return null
  }

  const quantityMatch = /^(\d+)\s+(.+)$/u.exec(cleaned)
  const quantity = quantityMatch?.[1]
  const rawTitle = quantityMatch?.[2] ?? cleaned
  const title = normalizeShoppingWord(rawTitle)

  return createDefinedObject({
    quantity,
    title,
  })
}

function normalizeShoppingWord(text: string): string {
  const normalized = text.replace(/[.:]+$/gu, '').trim()

  return SHOPPING_TITLE_NORMALIZATION[normalized] ?? normalized
}

function dedupeItems(items: PlannerIntentItem[]): PlannerIntentItem[] {
  const seen = new Set<string>()
  const result: PlannerIntentItem[] = []

  for (const item of items) {
    const key = `${item.title}:${item.quantity ?? ''}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(item)
  }

  return result
}

function parseRelativeReminder(
  text: string,
  now: Date,
): DateTimeParseResult | null {
  const match =
    /(?:^|\s)через\s+(\d+)\s+(минуту|минуты|минут|час|часа|часов|день|дня|дней)(?=\s|$)/iu.exec(
      text,
    )

  if (!match?.[1] || !match[2]) {
    return null
  }

  const amount = Number(match[1])
  const unit = match[2]

  if (!Number.isInteger(amount) || amount <= 0) {
    return null
  }

  const minutes =
    unit.startsWith('минут') || unit === 'минуту'
      ? amount
      : unit.startsWith('час')
        ? amount * 60
        : amount * 24 * 60

  return {
    ambiguousTime: false,
    datePrecision: 'relative',
    dateText: match[0],
    hasExactRelativeReminder: true,
    hasRelativeReminder: true,
    reminderAt: formatDateTime(addMinutes(now, minutes)),
  }
}

function parseDate(
  text: string,
  now: Date,
):
  | {
      date: string
      datePrecision: PlannerIntentDatePrecision
      dateText: string
    }
  | undefined {
  if (containsWord(text, 'сегодня')) {
    return {
      date: formatDateKey(now),
      datePrecision: 'exact',
      dateText: 'сегодня',
    }
  }

  if (containsWord(text, 'послезавтра')) {
    return {
      date: formatDateKey(addDays(now, 2)),
      datePrecision: 'exact',
      dateText: 'послезавтра',
    }
  }

  if (containsWord(text, 'завтра')) {
    return {
      date: formatDateKey(addDays(now, 1)),
      datePrecision: 'exact',
      dateText: 'завтра',
    }
  }

  const nextWeekMatch =
    /(?:^|\s)на\s+следующ(?:ей|ую)\s+недел[ею](?=\s|$)/iu.exec(text)

  if (nextWeekMatch) {
    return {
      date: formatDateKey(startOfNextWeek(now)),
      datePrecision: 'period',
      dateText: nextWeekMatch[0],
    }
  }

  const weekdayMatch = WEEKDAY_PATTERN.exec(text)

  if (weekdayMatch?.[2]) {
    const weekday = WEEKDAY_INDEX[weekdayMatch[2]]

    if (weekday !== undefined) {
      const isExplicitNext = Boolean(weekdayMatch[1])

      return {
        date: formatDateKey(nextWeekday(now, weekday, isExplicitNext)),
        datePrecision: 'date_only',
        dateText: weekdayMatch[0].trim(),
      }
    }
  }

  const numericDateMatch =
    /(?:^|\s)(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?=\s|$)/u.exec(text)

  if (!numericDateMatch?.[1] || !numericDateMatch[2]) {
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

  return {
    date: formatDateParts(year, month, day),
    datePrecision: 'exact',
    dateText: numericDateMatch[0],
  }
}

function parseTime(
  text: string,
): { ambiguous: boolean; time: string } | undefined {
  const timeMatch =
    /(?:^|\s)(?:в|к)\s*(\d{1,2})(?::(\d{2}))?\s*(?:час(?:ов|а)?\s*)?(утра|вечера|дня|ночи)?(?=\s|$)/iu.exec(
      text,
    )

  if (!timeMatch?.[1]) {
    return undefined
  }

  let hours = Number(timeMatch[1])
  const minutes = timeMatch[2] ? Number(timeMatch[2]) : 0
  const period = timeMatch[3]

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

  return {
    ambiguous: !period && minutes === 0 && hours >= 1 && hours <= 8,
    time: `${pad2(hours)}:${pad2(minutes)}`,
  }
}

function parseApproximateTime(
  text: string,
): { dateText: string; time: string } | undefined {
  if (containsWord(text, 'утром')) {
    return { dateText: 'утром', time: '09:00' }
  }

  if (containsWord(text, 'днем')) {
    return { dateText: 'днем', time: '14:00' }
  }

  if (containsWord(text, 'вечером')) {
    return { dateText: 'вечером', time: '19:00' }
  }

  if (containsWord(text, 'ночью')) {
    return { dateText: 'ночью', time: '22:00' }
  }

  return undefined
}

function resolveDatePrecision(
  date:
    | {
        date: string
        datePrecision: PlannerIntentDatePrecision
        dateText: string
      }
    | undefined,
  time: { ambiguous: boolean; time: string } | undefined,
  approximateTime: { dateText: string; time: string } | undefined,
): PlannerIntentDatePrecision | undefined {
  if (time?.ambiguous || approximateTime) {
    return 'unknown'
  }

  if (date?.datePrecision === 'period') {
    return 'period'
  }

  if (date && time) {
    return 'exact'
  }

  return date?.datePrecision
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
  alternatives?: string[] | undefined
  clarificationQuestion?: string | undefined
  confidence: number
  date?: string | undefined
  datePrecision?: PlannerIntentDatePrecision | undefined
  dateText?: string | undefined
  intent: PlannerIntentName
  isDangerous?: boolean | undefined
  items?: PlannerIntentItem[] | undefined
  needsConfirmation: boolean
  priority?: 'low' | 'normal' | 'high' | undefined
  rawText: string
  recurrence?: PlannerIntentRecurrence | undefined
  reminderAt?: string | undefined
  requiresUnlock?: boolean | undefined
  sphereConfidence?: number | undefined
  sphereId?: string | undefined
  targetQuery?: string | undefined
  time?: string | undefined
  title?: string | undefined
  transcript?: string | undefined
}): PlannerIntent {
  return plannerIntentSchema.parse(createDefinedObject(input))
}

function createDefinedObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T
}

function containsWord(text: string, word: string): boolean {
  const escaped = escapeRegExp(word)
  const pattern = new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, 'iu')

  return pattern.test(text)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function joinText(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (left && right) {
    return `${left} ${right}`
  }

  return left ?? right
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100))
}

function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + days)

  return nextDate
}

function addMinutes(date: Date, minutes: number): Date {
  const nextDate = new Date(date)
  nextDate.setMinutes(nextDate.getMinutes() + minutes)

  return nextDate
}

function nextWeekday(
  date: Date,
  targetWeekday: number,
  forceNext: boolean,
): Date {
  const currentWeekday = date.getDay()
  let delta = (targetWeekday - currentWeekday + 7) % 7

  if (forceNext || delta === 0) {
    delta += 7
  }

  return addDays(date, delta)
}

function startOfNextWeek(date: Date): Date {
  const currentWeekday = date.getDay() === 0 ? 7 : date.getDay()
  const daysUntilNextMonday = 8 - currentWeekday

  return addDays(date, daysUntilNextMonday)
}

function formatDateTime(date: Date): string {
  return `${formatDateKey(date)}T${pad2(date.getHours())}:${pad2(
    date.getMinutes(),
  )}`
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
