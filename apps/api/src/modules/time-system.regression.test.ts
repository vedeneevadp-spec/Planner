import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

import {
  cleaningTaskActionResponseSchema,
  cleaningTaskRecordSchema,
  cleaningTodayResponseSchema,
  getTodayDate,
  habitRecordSchema,
  habitTodayResponseSchema,
  selfCareDashboardResponseSchema,
  selfCareItemSchema,
  taskListResponseSchema,
  taskRecordSchema,
} from '@planner/contracts'

import { buildApiApp } from '../bootstrap/build-app.js'
import { createApiConfig } from '../bootstrap/config.js'
import { CleaningService, MemoryCleaningRepository } from './cleaning/index.js'
import { HabitService, MemoryHabitRepository } from './habits/index.js'
import { MemorySelfCareRepository, SelfCareService } from './self-care/index.js'
import { MemorySessionRepository, SessionService } from './session/index.js'
import { MemoryTaskRepository, TaskService } from './tasks/index.js'
import { serializeNullableDate } from './tasks/task.repository.postgres.mapper.js'

const ACTOR_USER_ID = '11111111-1111-4111-8111-111111111111'
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'
const REFERENCE_INSTANT = '2026-06-24T20:30:00.000Z'

let app: ReturnType<typeof buildApiApp> | null = null

void describe('Time System regression', () => {
  afterEach(async () => {
    mock.timers.reset()
    await app?.close()
    app = null
  })

  void it('serializes PostgreSQL date-only values without timezone shifts', () => {
    assert.equal(serializeNullableDate('2026-06-25'), '2026-06-25')
    assert.equal(
      serializeNullableDate(new Date('2026-06-25T00:00:00.000Z')),
      '2026-06-25',
    )
    assert.equal(serializeNullableDate(null), null)
  })

  void it('keeps planner dates stable when switching from Astrakhan to Amsterdam', async () => {
    mock.timers.enable({
      apis: ['Date'],
      now: new Date(REFERENCE_INSTANT),
    })
    app = createRegressionApp()

    assert.equal(getTodayDate('Europe/Astrakhan'), '2026-06-25')
    assert.equal(getTodayDate('Europe/Amsterdam'), '2026-06-24')

    await patchPreferences({
      defaultTimeZone: 'Europe/Astrakhan',
      lastSeenTimeZone: 'Europe/Astrakhan',
      timeZoneMode: 'manual',
    })

    const dateOnlyTask = taskRecordSchema.parse(
      await injectJson({
        headers: writeHeaders('Europe/Astrakhan'),
        method: 'POST',
        payload: createTaskPayload({
          plannedDate: '2026-06-25',
          plannedStartTime: null,
          title: 'Date-only tax payment',
        }),
        statusCode: 201,
        url: '/api/v1/tasks',
      }),
    )
    const fixedTask = taskRecordSchema.parse(
      await injectJson({
        headers: writeHeaders('Europe/Astrakhan'),
        method: 'POST',
        payload: createTaskPayload({
          plannedDate: '2026-06-25',
          plannedEndTime: '19:00',
          plannedStartTime: '18:00',
          title: 'Fixed-zone massage',
        }),
        statusCode: 201,
        url: '/api/v1/tasks',
      }),
    )

    assert.deepEqual(dateOnlyTask.schedule, {
      kind: 'date_only',
      localDate: '2026-06-25',
    })
    assert.deepEqual(fixedTask.schedule, {
      instantUtc: '2026-06-25T14:00:00.000Z',
      kind: 'fixed_zone_datetime',
      localDate: '2026-06-25',
      localTime: '18:00',
      timeZone: 'Europe/Astrakhan',
      timeZoneInferred: true,
    })

    const astrakhanTodayTasks = taskListResponseSchema.parse(
      await injectJson({
        headers: readHeaders('Europe/Astrakhan'),
        method: 'GET',
        statusCode: 200,
        url: '/api/v1/tasks?plannedDate=2026-06-25',
      }),
    )
    assertTaskIds(astrakhanTodayTasks, [dateOnlyTask.id, fixedTask.id])

    await patchPreferences({
      defaultTimeZone: 'Europe/Amsterdam',
      lastSeenTimeZone: 'Europe/Amsterdam',
      timeZoneMode: 'manual',
    })

    const amsterdamTodayTasks = taskListResponseSchema.parse(
      await injectJson({
        headers: readHeaders('Europe/Amsterdam'),
        method: 'GET',
        statusCode: 200,
        url: '/api/v1/tasks?plannedDate=2026-06-24',
      }),
    )
    assertTaskIds(amsterdamTodayTasks, [])

    const amsterdamCalendarTasks = taskListResponseSchema.parse(
      await injectJson({
        headers: readHeaders('Europe/Amsterdam'),
        method: 'GET',
        statusCode: 200,
        url: '/api/v1/tasks?plannedDate=2026-06-25',
      }),
    )
    const amsterdamFixedTask = amsterdamCalendarTasks.find(
      (task) => task.id === fixedTask.id,
    )
    assert.deepEqual(amsterdamFixedTask?.schedule, fixedTask.schedule)

    const habit = habitRecordSchema.parse(
      await injectJson({
        headers: writeHeaders('Europe/Astrakhan'),
        method: 'POST',
        payload: {
          reminderTime: '08:00',
          title: 'Morning water',
        },
        statusCode: 201,
        url: '/api/v1/habits',
      }),
    )
    assert.equal(habit.startDate, '2026-06-25')

    const astrakhanHabits = habitTodayResponseSchema.parse(
      await injectJson({
        headers: readHeaders('Europe/Astrakhan'),
        method: 'GET',
        statusCode: 200,
        url: '/api/v1/habits/today',
      }),
    )
    assert.equal(astrakhanHabits.date, '2026-06-25')
    assert.ok(astrakhanHabits.items.some((item) => item.habit.id === habit.id))

    const amsterdamHabits = habitTodayResponseSchema.parse(
      await injectJson({
        headers: readHeaders('Europe/Amsterdam'),
        method: 'GET',
        statusCode: 200,
        url: '/api/v1/habits/today',
      }),
    )
    assert.equal(amsterdamHabits.date, '2026-06-24')
    assert.ok(amsterdamHabits.items.every((item) => item.habit.id !== habit.id))

    const cleaningCompleted = cleaningTaskRecordSchema.parse(
      await injectJson({
        headers: writeHeaders('Europe/Astrakhan'),
        method: 'POST',
        payload: {
          scope: 'general',
          title: 'Clean desk',
        },
        statusCode: 201,
        url: '/api/v1/cleaning/tasks',
      }),
    )
    const cleaningSkipped = cleaningTaskRecordSchema.parse(
      await injectJson({
        headers: writeHeaders('Europe/Amsterdam'),
        method: 'POST',
        payload: {
          scope: 'general',
          title: 'Clean sink',
        },
        statusCode: 201,
        url: '/api/v1/cleaning/tasks',
      }),
    )
    const completedAction = cleaningTaskActionResponseSchema.parse(
      await injectJson({
        headers: writeHeaders('Europe/Astrakhan'),
        method: 'POST',
        payload: {},
        statusCode: 200,
        url: `/api/v1/cleaning/tasks/${cleaningCompleted.id}/complete`,
      }),
    )
    const skippedAction = cleaningTaskActionResponseSchema.parse(
      await injectJson({
        headers: writeHeaders('Europe/Amsterdam'),
        method: 'POST',
        payload: {},
        statusCode: 200,
        url: `/api/v1/cleaning/tasks/${cleaningSkipped.id}/skip`,
      }),
    )
    assert.equal(completedAction.historyItem.date, '2026-06-25')
    assert.equal(skippedAction.historyItem.date, '2026-06-24')

    const astrakhanCleaning = cleaningTodayResponseSchema.parse(
      await injectJson({
        headers: readHeaders('Europe/Astrakhan'),
        method: 'GET',
        statusCode: 200,
        url: '/api/v1/cleaning/today',
      }),
    )
    const amsterdamCleaning = cleaningTodayResponseSchema.parse(
      await injectJson({
        headers: readHeaders('Europe/Amsterdam'),
        method: 'GET',
        statusCode: 200,
        url: '/api/v1/cleaning/today',
      }),
    )
    assert.equal(astrakhanCleaning.date, '2026-06-25')
    assert.equal(amsterdamCleaning.date, '2026-06-24')

    const selfCareItem = selfCareItemSchema.parse(
      await injectJson({
        headers: writeHeaders('Europe/Astrakhan'),
        method: 'POST',
        payload: {
          category: 'daily_base',
          title: 'Morning care',
          type: 'habit',
        },
        statusCode: 201,
        url: '/api/v1/self-care',
      }),
    )
    const astrakhanSelfCare = selfCareDashboardResponseSchema.parse(
      await injectJson({
        headers: readHeaders('Europe/Astrakhan'),
        method: 'GET',
        statusCode: 200,
        url: '/api/v1/self-care/dashboard',
      }),
    )
    const amsterdamSelfCare = selfCareDashboardResponseSchema.parse(
      await injectJson({
        headers: readHeaders('Europe/Amsterdam'),
        method: 'GET',
        statusCode: 200,
        url: '/api/v1/self-care/dashboard',
      }),
    )
    assert.equal(astrakhanSelfCare.date, '2026-06-25')
    assert.ok(
      astrakhanSelfCare.todayItems.some(
        (item) => item.item.id === selfCareItem.id,
      ),
    )
    assert.equal(amsterdamSelfCare.date, '2026-06-24')
    assert.ok(
      amsterdamSelfCare.todayItems.every(
        (item) => item.item.id !== selfCareItem.id,
      ),
    )
  })
})

function createRegressionApp() {
  return buildApiApp({
    cleaningService: new CleaningService(new MemoryCleaningRepository()),
    config: createApiConfig({
      API_STORAGE_DRIVER: 'memory',
      NODE_ENV: 'test',
    }),
    database: null,
    habitService: new HabitService(new MemoryHabitRepository()),
    selfCareService: new SelfCareService(new MemorySelfCareRepository()),
    sessionService: new SessionService(new MemorySessionRepository()),
    taskService: new TaskService(new MemoryTaskRepository()),
  })
}

async function patchPreferences(input: {
  defaultTimeZone: string
  lastSeenTimeZone: string
  timeZoneMode: 'manual'
}) {
  await injectJson({
    headers: writeHeaders(input.defaultTimeZone),
    method: 'PATCH',
    payload: input,
    statusCode: 200,
    url: '/api/v1/preferences',
  })
}

async function injectJson(input: {
  headers: Record<string, string>
  method: 'GET' | 'PATCH' | 'POST'
  payload?: object
  statusCode: number
  url: string
}): Promise<unknown> {
  assert.ok(app, 'Expected test app to be initialized.')
  const currentApp = app
  const baseRequest = {
    headers: input.headers,
    method: input.method,
    url: input.url,
  }
  const response =
    input.payload === undefined
      ? await currentApp.inject(baseRequest)
      : await currentApp.inject({
          ...baseRequest,
          payload: input.payload,
        })

  assert.equal(response.statusCode, input.statusCode, response.body)

  return JSON.parse(response.body) as unknown
}

function readHeaders(timeZone: string): Record<string, string> {
  return {
    'x-client-timezone': timeZone,
    'x-workspace-id': WORKSPACE_ID,
  }
}

function writeHeaders(timeZone: string): Record<string, string> {
  return {
    ...readHeaders(timeZone),
    'x-actor-user-id': ACTOR_USER_ID,
  }
}

function createTaskPayload(input: {
  plannedDate: string
  plannedEndTime?: string | null
  plannedStartTime: string | null
  title: string
}) {
  return {
    dueDate: null,
    icon: '',
    importance: 'not_important',
    note: '',
    plannedDate: input.plannedDate,
    plannedEndTime: input.plannedEndTime ?? null,
    plannedStartTime: input.plannedStartTime,
    project: '',
    projectId: null,
    resource: null,
    requiresConfirmation: false,
    sphereId: null,
    title: input.title,
    urgency: 'not_urgent',
  }
}

function assertTaskIds(
  tasks: Array<{ id: string }>,
  expectedIds: string[],
): void {
  assert.deepEqual(tasks.map((task) => task.id).sort(), [...expectedIds].sort())
}
