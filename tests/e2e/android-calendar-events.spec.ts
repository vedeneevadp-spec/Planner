import { expect, test } from '@playwright/test'

interface IncomingEvent {
  requestId: string
  title: string
  description: string
  location: string
  beginTime: number | null
  endTime: number | null
  allDay: boolean
}

declare global {
  interface Window {
    __calendarImportTest: {
      calls: string[]
      enqueue(event: IncomingEvent): void
    }
  }
}

test.use({
  viewport: { width: 390, height: 844 },
  locale: 'ru-RU',
  timezoneId: 'Asia/Novosibirsk',
})

test('imports an Android event after login, saves on confirmation and preserves an existing form', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    let listener: (() => void) | undefined
    let queue: IncomingEvent[] = [
      {
        requestId: 'calendar-first',
        title: 'Встреча по проекту',
        description: 'Обсудить макет',
        location: 'Переговорная',
        beginTime: Date.parse('2026-11-05T11:40:00Z'),
        endTime: Date.parse('2026-11-05T12:30:00Z'),
        allDay: false,
      },
    ]
    const calls: string[] = []
    Object.assign(window, {
      __calendarImportTest: {
        calls,
        enqueue(event: IncomingEvent) {
          queue.push(event)
          listener?.()
        },
      },
      CapacitorCustomPlatform: { name: 'android' },
      Capacitor: {
        nativeCallback(
          plugin: string,
          _method: string,
          _options: unknown,
          callback: () => void,
        ) {
          if (plugin === 'PlannerCalendarEvents') listener = callback
          return 'test-listener'
        },
        nativePromise(
          plugin: string,
          method: string,
          options: Record<string, string> = {},
        ) {
          if (plugin === 'PlannerCalendarEvents') {
            calls.push(method)
            if (method === 'acknowledgeEvent')
              queue = queue.filter(
                (event) => event.requestId !== options.requestId,
              )
            return Promise.resolve({ event: queue[0] ?? null })
          }
          if (plugin === 'PlannerAuthStorage') {
            const key = String(options.key)
            if (method === 'get')
              return Promise.resolve({ value: localStorage.getItem(key) })
            if (method === 'set')
              localStorage.setItem(key, String(options.value))
            if (method === 'remove') localStorage.removeItem(key)
          }
          return Promise.resolve({})
        },
        PluginHeaders: [
          {
            name: 'PlannerCalendarEvents',
            methods: ['readPendingEvent', 'acknowledgeEvent', 'removeListener']
              .map((name) => ({ name, rtype: 'promise' }))
              .concat([{ name: 'addListener', rtype: 'callback' }]),
          },
          {
            name: 'PlannerAuthStorage',
            methods: [
              'get',
              'set',
              'remove',
              'prepareRefresh',
              'commitRefresh',
            ].map((name) => ({ name, rtype: 'promise' })),
          },
        ],
      },
    })
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/today')
  expect(await page.evaluate(() => window.__calendarImportTest.calls)).toEqual(
    [],
  )
  await page
    .getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' })
    .click()
  await page.getByLabel('Имя').fill('События')
  await page
    .getByLabel('Email')
    .fill(`calendar-intent-${Date.now()}@example.test`)
  await page.getByLabel('Пароль', { exact: true }).fill('e2e-password')
  await page.getByLabel('Подтвердите пароль').fill('e2e-password')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  const dialog = page.getByRole('dialog', { name: 'Новая задача', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Задача', { exact: true })).toHaveValue(
    'Встреча по проекту',
  )
  await expect(dialog.getByLabel('План', { exact: true })).toHaveValue(
    '2026-11-05',
  )
  await expect(dialog.getByLabel('Старт', { exact: true })).toHaveValue('18:40')
  await expect(
    dialog.getByLabel('Финиш', { exact: true }).filter({ visible: true }),
  ).toHaveValue('19:30')
  await expect(
    dialog.getByRole('textbox', { name: 'Заметка', exact: true }),
  ).toHaveValue('Обсудить макет\n\nМесто: Переговорная')
  expect(
    await page.evaluate(() => window.__calendarImportTest.calls),
  ).not.toContain('acknowledgeEvent')
  await page.screenshot({
    path: testInfo.outputPath('calendar-event-draft.png'),
    fullPage: true,
  })
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/tasks',
  )
  await dialog
    .getByRole('button', { name: 'Добавить задачу', exact: true })
    .first()
    .click()
  expect((await created).ok()).toBe(true)
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: 'Новая задача', exact: true }).click()
  await dialog
    .getByLabel('Задача', { exact: true })
    .fill('Моя незаконченная задача')
  await page.evaluate(() =>
    window.__calendarImportTest.enqueue({
      requestId: 'calendar-second',
      title: 'Второе событие',
      description: '',
      location: '',
      beginTime: null,
      endTime: null,
      allDay: false,
    }),
  )
  await expect(dialog.getByLabel('Задача', { exact: true })).toHaveValue(
    'Моя незаконченная задача',
  )
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(dialog.getByLabel('Задача', { exact: true })).toHaveValue(
    'Второе событие',
  )
  await expect(
    dialog.getByRole('button', { name: 'Указать дату' }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(errors).toEqual([])
})
