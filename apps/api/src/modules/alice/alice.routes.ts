import type { NewTaskInput, Task } from '@planner/contracts'
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
import type {
  AliceCommandParser,
  AliceCommandParserInput,
  AliceParsedCreateTaskCommand,
  AliceParsedListTasksCommand,
  AliceParsedShoppingCommand,
} from './alice-command-parser.js'
import {
  addDaysToDateKey,
  getDateKeyInTimeZone,
  normalizeTimeZone,
} from './alice-command-parser.js'

const ALICE_PROTOCOL_VERSION = '1.0'
const MAX_ALICE_TEXT_LENGTH = 1024

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
  commandParser: AliceCommandParser
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
  const parserInput = createParserInput(body)
  const parsedCommand = await options.commandParser.parse(parserInput)

  request.log.info(
    {
      confidence: parsedCommand.confidence,
      intent: parsedCommand.intent,
      source: parsedCommand.source,
    },
    'Alice command parsed.',
  )

  if (parsedCommand.intent === 'ping') {
    return createTextResponse('pong', { endSession: true })
  }

  if (parsedCommand.intent === 'exit') {
    return createTextResponse('Готово, выхожу.', { endSession: true })
  }

  if (parsedCommand.intent === 'help') {
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

  if (!parserInput.command) {
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

  if (parsedCommand.intent === 'list_tasks') {
    return createTaskListResponse(parsedCommand, body, authContext, options)
  }

  if (parsedCommand.intent === 'add_shopping_item') {
    return createShoppingListItem(parsedCommand, body, authContext, options)
  }

  if (parsedCommand.intent !== 'create_task') {
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

  return createPlannerTask(parsedCommand, body, authContext, options)
}

async function createPlannerTask(
  draft: AliceParsedCreateTaskCommand,
  body: AliceWebhookRequest,
  authContext: AuthenticatedRequestContext,
  options: RegisterAliceRoutesOptions,
): Promise<AliceTextResponse> {
  const session = await options.sessionService.resolveSession({
    actorUserId: undefined,
    auth: authContext,
    workspaceId: getRequestedWorkspaceId(body),
  })
  const task = await options.taskService.createTask(
    createTaskWriteContext(session, authContext),
    createNewTaskInput(draft),
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
  draft: AliceParsedShoppingCommand,
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
          isFavorite: false,
          kind: 'shopping',
          priority: null,
          shoppingCategory: null,
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

async function createTaskListResponse(
  command: AliceParsedListTasksCommand,
  body: AliceWebhookRequest,
  authContext: AuthenticatedRequestContext,
  options: RegisterAliceRoutesOptions,
): Promise<AliceTextResponse> {
  const session = await options.sessionService.resolveSession({
    actorUserId: undefined,
    auth: authContext,
    workspaceId: getRequestedWorkspaceId(body),
  })
  const tasks = await options.taskService.listTasks(
    createTaskReadContext(session, authContext),
    {
      plannedDate: command.plannedDate,
    },
  )
  const activeTasks = tasks.filter((task) => task.status !== 'done')
  const label = command.range === 'today' ? 'сегодня' : 'завтра'

  if (activeTasks.length === 0) {
    return createTextResponse(`На ${label} задач нет.`, {
      buttons: [
        { hide: true, title: 'Добавь задачу позвонить завтра' },
        { hide: true, title: 'Надо купить молоко' },
      ],
    })
  }

  const visibleTasks = activeTasks.slice(0, 5)
  const taskList = visibleTasks
    .map((task, index) => formatTaskForSpeech(index, task))
    .join('. ')
  const hiddenCount = activeTasks.length - visibleTasks.length
  const hiddenSuffix =
    hiddenCount > 0 ? ` И еще ${formatTaskCount(hiddenCount)}.` : ''

  return createTextResponse(`На ${label}: ${taskList}.${hiddenSuffix}`, {
    buttons: [
      {
        hide: true,
        title:
          command.range === 'today' ? 'Задачи на завтра' : 'Задачи на сегодня',
      },
      { hide: true, title: 'Добавить задачу' },
    ],
  })
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

function createParserInput(body: AliceWebhookRequest): AliceCommandParserInput {
  return {
    command: body.request?.command?.trim() ?? '',
    entities: (body.request?.nlu?.entities ?? []).map((entity) => {
      if ('value' in entity) {
        return {
          type: entity.type,
          value: entity.value,
        }
      }

      return {
        type: entity.type,
      }
    }),
    originalUtterance: body.request?.original_utterance,
    timeZone: body.meta?.timezone,
  }
}

function createNewTaskInput(draft: AliceParsedCreateTaskCommand): NewTaskInput {
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

function createTaskReadContext(
  session: SessionSnapshot,
  authContext: AuthenticatedRequestContext,
) {
  return {
    actorUserId: session.actorUserId,
    auth: authContext,
    groupRole: session.groupRole,
    role: session.role,
    workspaceId: session.workspaceId,
    workspaceKind: session.workspace.kind,
  }
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

function formatTaskForSpeech(index: number, task: Task): string {
  const timePrefix = task.plannedStartTime ? `в ${task.plannedStartTime} ` : ''

  return `${index + 1}. ${timePrefix}${task.title}`
}

function formatTaskCount(count: number): string {
  const lastDigit = count % 10
  const lastTwoDigits = count % 100
  const word =
    lastDigit === 1 && lastTwoDigits !== 11
      ? 'задача'
      : lastDigit >= 2 &&
          lastDigit <= 4 &&
          (lastTwoDigits < 12 || lastTwoDigits > 14)
        ? 'задачи'
        : 'задач'

  return `${count} ${word}`
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

function supportsAccountLinking(body: AliceWebhookRequest): boolean {
  return body.meta?.interfaces?.account_linking !== undefined
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

function truncateAliceText(value: string): string {
  if (value.length <= MAX_ALICE_TEXT_LENGTH) {
    return value
  }

  return value.slice(0, MAX_ALICE_TEXT_LENGTH - 1).trimEnd()
}
