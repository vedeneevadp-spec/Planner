import type { NewTaskInput } from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import type { JwtAuthRuntimeConfig } from '../../infrastructure/auth/jwt-request-authenticator.js'
import { verifyJwtAccessToken } from '../../infrastructure/auth/jwt-request-authenticator.js'
import type { ChaosInboxService } from '../chaos-inbox/index.js'
import type { SessionService } from '../session/index.js'
import type { SessionSnapshot } from '../session/session.model.js'
import type { TaskService } from '../tasks/index.js'

const ALICE_PROTOCOL_VERSION = '1.0'
const MAX_ALICE_TEXT_LENGTH = 1024
const DEFAULT_TIME_ZONE = 'Europe/Moscow'

const aliceNluEntitySchema = z
  .object({
    tokens: z
      .object({
        end: z.number().int().nonnegative(),
        start: z.number().int().nonnegative(),
      })
      .optional(),
    type: z.string(),
    value: z.unknown().optional(),
  })
  .passthrough()

const aliceWebhookRequestSchema = z
  .object({
    account_linking_complete_event: z.unknown().optional(),
    meta: z
      .object({
        interfaces: z
          .object({
            account_linking: z.unknown().optional(),
          })
          .passthrough()
          .optional(),
        timezone: z.string().optional(),
      })
      .passthrough()
      .optional(),
    request: z
      .object({
        command: z.string().optional(),
        nlu: z
          .object({
            entities: z.array(aliceNluEntitySchema).optional(),
            tokens: z.array(z.string()).optional(),
          })
          .passthrough()
          .optional(),
        original_utterance: z.string().optional(),
        payload: z.unknown().optional(),
        type: z.string().optional(),
      })
      .passthrough()
      .optional(),
    session: z
      .object({
        new: z.boolean().optional(),
        user: z
          .object({
            access_token: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    state: z
      .object({
        application: z.record(z.string(), z.unknown()).optional(),
        session: z.record(z.string(), z.unknown()).optional(),
        user: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    version: z.string().optional(),
  })
  .passthrough()

type AliceWebhookRequest = z.infer<typeof aliceWebhookRequestSchema>

interface RegisterAliceRoutesOptions {
  chaosInboxService?: ChaosInboxService
  jwtAuth: JwtAuthRuntimeConfig | null
  sessionService: SessionService
  taskService: TaskService
}

interface AliceButton {
  hide?: boolean
  payload?: Record<string, unknown>
  title: string
}

interface AliceTextResponse {
  response: {
    buttons?: AliceButton[]
    end_session: boolean
    text: string
  }
  version: typeof ALICE_PROTOCOL_VERSION
}

interface AliceAccountLinkingResponse {
  start_account_linking: Record<string, never>
  version: typeof ALICE_PROTOCOL_VERSION
}

type AliceResponse = AliceAccountLinkingResponse | AliceTextResponse

interface TaskDraft {
  plannedDate: string | null
  plannedEndTime: string | null
  plannedStartTime: string | null
  reminderTimeZone: string | undefined
  title: string
}

interface ShoppingDraft {
  text: string
}

interface ScheduleDraft {
  plannedDate: string | null
  plannedStartTime: string | null
  reminderTimeZone: string | undefined
}

export function registerAliceRoutes(
  app: FastifyInstance,
  options: RegisterAliceRoutesOptions,
): void {
  app.post('/api/v1/alice/webhook', async (request, reply) => {
    const parsedRequest = aliceWebhookRequestSchema.safeParse(
      request.body ?? {},
    )

    reply.header('cache-control', 'no-store')

    if (!parsedRequest.success) {
      return createTextResponse(
        'Не смогла разобрать запрос навыка. Попробуйте еще раз.',
      )
    }

    try {
      return await handleAliceRequest(request, parsedRequest.data, options)
    } catch (error) {
      if (error instanceof HttpError) {
        return createHttpErrorResponse(error, parsedRequest.data)
      }

      request.log.error({ err: error }, 'Alice webhook request failed.')

      return createTextResponse(
        'Не смогла создать задачу. Попробуйте еще раз чуть позже.',
      )
    }
  })
}

async function handleAliceRequest(
  request: FastifyRequest,
  body: AliceWebhookRequest,
  options: RegisterAliceRoutesOptions,
): Promise<AliceResponse> {
  const command = getNormalizedCommand(body)

  if (isPingCommand(command, body)) {
    return createTextResponse('pong', { endSession: true })
  }

  if (isExitCommand(command)) {
    return createTextResponse('Готово, выхожу.', { endSession: true })
  }

  if (isHelpCommand(command)) {
    return createHelpResponse()
  }

  const authContext = await resolveAliceAuthContext(request, body, options)

  if (!authContext) {
    return createAuthorizationRequiredResponse(body)
  }

  if (body.account_linking_complete_event) {
    return createTextResponse(
      'Аккаунт связан. Теперь скажите: добавь задачу купить молоко завтра.',
      {
        buttons: [{ hide: true, title: 'Помощь' }],
      },
    )
  }

  if (!command || body.session?.new) {
    return createTextResponse(
      'Могу добавить задачу или покупку. Например: добавь задачу позвонить завтра в 9. Или: надо купить молоко.',
      {
        buttons: [
          { hide: true, title: 'Добавь задачу позвонить завтра' },
          { hide: true, title: 'Надо купить молоко' },
          { hide: true, title: 'Помощь' },
        ],
      },
    )
  }

  const shoppingDraft = createShoppingDraft(command)

  if (shoppingDraft) {
    return createShoppingListItem(shoppingDraft, body, authContext, options)
  }

  const taskDraft = createTaskDraft(body)

  if (!taskDraft) {
    return createTextResponse(
      'Что добавить? Скажите, например: добавь задачу позвонить завтра. Или: надо купить молоко.',
      {
        buttons: [
          { hide: true, title: 'Добавь задачу позвонить завтра' },
          { hide: true, title: 'Надо купить молоко' },
        ],
      },
    )
  }

  const session = await options.sessionService.resolveSession({
    actorUserId: undefined,
    auth: authContext,
    workspaceId: getRequestedWorkspaceId(body),
  })
  const task = await options.taskService.createTask(
    createTaskWriteContext(session, authContext),
    createNewTaskInput(taskDraft),
  )

  return createTextResponse(
    `Готово. Добавила задачу: ${task.title}${formatScheduleSuffix(task, body)}.`,
    {
      buttons: [{ hide: true, title: 'Добавить еще' }],
    },
  )
}

function createHelpResponse(): AliceTextResponse {
  return createTextResponse(
    'Я добавляю задачи и покупки в Chaotika. Для задачи скажите: добавь задачу позвонить завтра в 9. Для списка покупок: надо купить молоко.',
    {
      buttons: [
        { hide: true, title: 'Добавь задачу позвонить завтра' },
        { hide: true, title: 'Надо купить молоко' },
        { hide: true, title: 'Выход' },
      ],
    },
  )
}

async function createShoppingListItem(
  draft: ShoppingDraft,
  body: AliceWebhookRequest,
  authContext: AuthenticatedRequestContext,
  options: RegisterAliceRoutesOptions,
): Promise<AliceTextResponse> {
  if (!options.chaosInboxService) {
    return createTextResponse('Список покупок сейчас недоступен.')
  }

  const session = await options.sessionService.resolveSession({
    actorUserId: undefined,
    auth: authContext,
    workspaceId: getRequestedWorkspaceId(body),
  })
  const items = await options.chaosInboxService.createItems(
    createWriteContext(session, authContext),
    {
      items: [
        {
          kind: 'shopping',
          source: 'voice',
          text: draft.text,
        },
      ],
    },
  )
  const item = items[0]

  return createTextResponse(
    `Готово. Добавила в список покупок: ${item?.text ?? draft.text}.`,
    {
      buttons: [{ hide: true, title: 'Добавить еще покупку' }],
    },
  )
}

async function resolveAliceAuthContext(
  request: FastifyRequest,
  body: AliceWebhookRequest,
  options: RegisterAliceRoutesOptions,
): Promise<AuthenticatedRequestContext | null> {
  const accessToken =
    readBearerToken(request.headers.authorization) ??
    body.session?.user?.access_token?.trim()

  if (!accessToken || !options.jwtAuth) {
    return null
  }

  try {
    return {
      accessToken,
      claims: await verifyJwtAccessToken(accessToken, options.jwtAuth),
    }
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 401) {
      return null
    }

    throw error
  }
}

function createAuthorizationRequiredResponse(
  body: AliceWebhookRequest,
): AliceResponse {
  if (!supportsAccountLinking(body)) {
    return createTextResponse(
      'Чтобы добавлять задачи, откройте навык на устройстве с поддержкой авторизации и свяжите аккаунт Chaotika.',
    )
  }

  return {
    start_account_linking: {},
    version: ALICE_PROTOCOL_VERSION,
  }
}

function createHttpErrorResponse(
  error: HttpError,
  body: AliceWebhookRequest,
): AliceResponse {
  if (error.statusCode === 401) {
    return createAuthorizationRequiredResponse(body)
  }

  if (error.code === 'workspace_write_forbidden') {
    return createTextResponse(
      'В выбранном рабочем пространстве нельзя создавать задачи.',
    )
  }

  if (error.code === 'workspace_access_denied') {
    return createTextResponse(
      'Не получилось открыть выбранное рабочее пространство. Проверьте доступ в приложении Chaotika.',
    )
  }

  return createTextResponse('Не смогла создать задачу. Попробуйте еще раз.')
}

function createTextResponse(
  text: string,
  options: {
    buttons?: AliceButton[]
    endSession?: boolean
  } = {},
): AliceTextResponse {
  const response: AliceTextResponse['response'] = {
    end_session: options.endSession ?? false,
    text: truncateAliceText(text),
  }

  if (options.buttons?.length) {
    response.buttons = options.buttons
  }

  return {
    response,
    version: ALICE_PROTOCOL_VERSION,
  }
}

function createTaskDraft(body: AliceWebhookRequest): TaskDraft | null {
  const command = getNormalizedCommand(body)
  const strippedTitle = stripTaskCommand(command)
  const schedule = resolveSchedule(body)
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

function createNewTaskInput(draft: TaskDraft): NewTaskInput {
  return {
    assigneeUserId: null,
    dueDate: null,
    icon: '',
    importance: 'not_important',
    note: '',
    plannedDate: draft.plannedDate,
    plannedEndTime: draft.plannedEndTime,
    plannedStartTime: draft.plannedStartTime,
    project: '',
    projectId: null,
    remindBeforeStart: false,
    reminderTimeZone: draft.reminderTimeZone,
    requiresConfirmation: false,
    resource: null,
    sphereId: null,
    title: draft.title,
    urgency: 'not_urgent',
  }
}

function createTaskWriteContext(
  session: SessionSnapshot,
  authContext: AuthenticatedRequestContext,
) {
  return createWriteContext(session, authContext)
}

function createWriteContext(
  session: SessionSnapshot,
  authContext: AuthenticatedRequestContext,
) {
  return {
    actorDisplayName: session.actor.displayName,
    actorUserId: session.actorUserId,
    auth: authContext,
    groupRole: session.groupRole,
    role: session.role,
    workspaceId: session.workspaceId,
    workspaceKind: session.workspace.kind,
  }
}

function createShoppingDraft(command: string): ShoppingDraft | null {
  if (isExplicitTaskCommand(command)) {
    return null
  }

  const text = stripShoppingCommand(command)

  if (!text) {
    return null
  }

  return { text }
}

function isExplicitTaskCommand(command: string): boolean {
  return /^(?:пожалуйста\s+)?(?:добавь|добавить|создай|создать|запиши|записать|поставь|поставить|запланируй|запланировать)\s+(?:мне\s+)?(?:задачу|дело)\b/u.test(
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
  ]

  for (const pattern of patterns) {
    const text = normalizeWhitespace(normalized.replace(pattern, ''))

    if (text !== normalized) {
      return text
    }
  }

  return ''
}

function resolveSchedule(body: AliceWebhookRequest): ScheduleDraft {
  const timeZone = normalizeTimeZone(body.meta?.timezone)
  const todayKey = getDateKeyInTimeZone(new Date(), timeZone)
  const nluSchedule = resolveNluSchedule(body, todayKey)
  const command = getNormalizedCommand(body)
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
  body: AliceWebhookRequest,
  todayKey: string,
): {
  plannedDate?: string | null
  plannedStartTime?: string | null
} {
  const dateTimeEntity = body.request?.nlu?.entities?.find(
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

function stripTaskCommand(command: string): string {
  return normalizeWhitespace(
    command
      .replace(
        /^(?:пожалуйста\s+)?(?:добавь|добавить|создай|создать|запиши|записать|поставь|поставить|запланируй|запланировать)\s+(?:мне\s+)?(?:(?:задачу|дело|напоминание)\s+)?/u,
        '',
      )
      .replace(/^(?:пожалуйста\s+)?напомни\s+(?:мне\s+)?/u, '')
      .replace(/^новая\s+задача\s+/u, ''),
  )
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

function formatScheduleSuffix(
  task: {
    plannedDate: string | null
    plannedStartTime: string | null
  },
  body: AliceWebhookRequest,
): string {
  if (!task.plannedDate && !task.plannedStartTime) {
    return ''
  }

  const timeZone = normalizeTimeZone(body.meta?.timezone)
  const todayKey = getDateKeyInTimeZone(new Date(), timeZone)
  const datePart = task.plannedDate
    ? ` на ${formatDateForSpeech(task.plannedDate, todayKey)}`
    : ''
  const timePart = task.plannedStartTime ? ` в ${task.plannedStartTime}` : ''

  return `${datePart}${timePart}`
}

function formatDateForSpeech(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) {
    return 'сегодня'
  }

  if (dateKey === addDaysToDateKey(todayKey, 1)) {
    return 'завтра'
  }

  const [year, month, day] = dateKey.split('-')

  if (!year || !month || !day) {
    return dateKey
  }

  return `${day}.${month}.${year}`
}

function isPingCommand(command: string, body: AliceWebhookRequest): boolean {
  return (
    command === 'ping' ||
    normalizeRussianText(body.request?.original_utterance ?? '') === 'ping'
  )
}

function isExitCommand(command: string): boolean {
  return /^(?:выход|выйти|закончить|стоп|хватит|отмена|спасибо)$/.test(command)
}

function isHelpCommand(command: string): boolean {
  return /^(?:помощь|помоги|что ты умеешь|что умеешь|что можно)$/.test(command)
}

function supportsAccountLinking(body: AliceWebhookRequest): boolean {
  return body.meta?.interfaces?.account_linking !== undefined
}

function getNormalizedCommand(body: AliceWebhookRequest): string {
  return normalizeWhitespace(body.request?.command ?? '').toLowerCase()
}

function getRequestedWorkspaceId(
  body: AliceWebhookRequest,
): string | undefined {
  const candidates = [
    body.state?.user?.workspaceId,
    body.state?.application?.workspaceId,
    body.state?.session?.workspaceId,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }

  return undefined
}

function readBearerToken(
  authorizationHeader: string | string[] | undefined,
): string | undefined {
  const header = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader

  if (!header) {
    return undefined
  }

  const [scheme, token] = header.split(' ')

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return undefined
  }

  return token
}

function normalizeRussianText(value: string): string {
  return normalizeWhitespace(value).toLowerCase().replaceAll('ё', 'е')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncateAliceText(value: string): string {
  if (value.length <= MAX_ALICE_TEXT_LENGTH) {
    return value
  }

  return value.slice(0, MAX_ALICE_TEXT_LENGTH - 1).trimEnd()
}

function normalizeTimeZone(value: string | undefined): string {
  const timeZone = value?.trim() || DEFAULT_TIME_ZONE

  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone }).format(new Date())
    return timeZone
  } catch {
    return DEFAULT_TIME_ZONE
  }
}

function getDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date)

  return formatDateKey(
    Number(getDatePart(parts, 'year')),
    Number(getDatePart(parts, 'month')),
    Number(getDatePart(parts, 'day')),
  )
}

function getDatePart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((part) => part.type === type)?.value ?? '0'
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1))

  date.setUTCDate(date.getUTCDate() + days)

  return formatDateKey(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  )
}

function resolveYearForMonthDay(
  todayKey: string,
  month: number,
  day: number,
): number {
  const [currentYear = 1970] = todayKey.split('-').map(Number)
  const candidate = formatDateKey(currentYear, month, day)

  return candidate < todayKey ? currentYear + 1 : currentYear
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

function findTargetWeekday(value: string): number | null {
  const weekdays: Array<{ aliases: string[]; day: number }> = [
    { aliases: ['понедельник', 'понедельника'], day: 1 },
    { aliases: ['вторник', 'вторника'], day: 2 },
    { aliases: ['среду', 'среда'], day: 3 },
    { aliases: ['четверг', 'четверга'], day: 4 },
    { aliases: ['пятницу', 'пятница'], day: 5 },
    { aliases: ['субботу', 'суббота'], day: 6 },
    { aliases: ['воскресенье', 'воскресенья'], day: 7 },
  ]

  for (const weekday of weekdays) {
    if (
      weekday.aliases.some((alias) =>
        new RegExp(`(?:^|\\s)(?:в|во|на|к)?\\s*${alias}(?=$|\\s)`, 'u').test(
          value,
        ),
      )
    ) {
      return weekday.day
    }
  }

  return null
}

function getDaysUntilWeekday(todayKey: string, targetWeekday: number): number {
  const [year, month, day] = todayKey.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1))
  const currentWeekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay()

  return (targetWeekday - currentWeekday + 7) % 7
}

function readInteger(value: unknown): number | undefined {
  return Number.isInteger(value) ? (value as number) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
