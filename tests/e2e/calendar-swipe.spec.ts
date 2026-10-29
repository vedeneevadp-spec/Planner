import { writeFile } from 'node:fs/promises'

import { addDateDays, getIsoWeekStartDate } from '@planner/contracts'
import { expect, test } from '@playwright/test'

test.use({
  viewport: { width: 393, height: 851 },
  isMobile: true,
  hasTouch: true,
  extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.14' },
})

test('accepts rapid Android touch swipes while populated weeks are loading', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(10_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/today')
  await page
    .getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' })
    .click()
  await page.getByLabel('Имя').fill('Проверка свайпов')
  await page
    .getByLabel('Email')
    .fill(`calendar-swipe-${Date.now()}@example.test`)
  await page.getByLabel('Пароль', { exact: true }).fill('e2e-password')
  await page.getByLabel('Подтвердите пароль').fill('e2e-password')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(
    page.getByRole('button', { name: 'Новая задача', exact: true }),
  ).toBeVisible()

  const read = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/tasks/cursor' &&
      response.ok(),
  )
  await page.goto('/calendar?calendarView=week')
  const response = await read
  const observed = await response.request().allHeaders()
  const headers = Object.fromEntries(
    [
      'authorization',
      'x-workspace-id',
      'x-actor-user-id',
      'x-client-timezone',
      'x-forwarded-for',
    ].flatMap((key) => (observed[key] ? [[key, observed[key]]] : [])),
  )
  const tasksUrl = new URL('/api/v1/tasks', response.url()).href
  const dateFrom = new URL(response.url()).searchParams.get('dateFrom')!
  const weekStart = getIsoWeekStartDate(addDateDays(dateFrom, 1))
  // A real account with timed tasks, history and ten daily recurring series.
  for (let batch = 0; batch < 10; batch += 1) {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, offset) => {
        const index = batch * 10 + offset
        const plannedDate = addDateDays(weekStart, index < 10 ? 0 : index - 30)
        const hour = String(9 + (index % 8)).padStart(2, '0')
        return page.request.post(tasksUrl, {
          headers,
          data: {
            title: `Задача календаря ${index}`,
            note: '',
            project: '',
            resource: -1,
            plannedDate,
            plannedStartTime: `${hour}:00`,
            plannedEndTime: `${hour}:30`,
            ...(index < 10
              ? { recurrence: { frequency: 'daily', startDate: plannedDate } }
              : {}),
          },
        })
      }),
    )
    for (const result of results) expect(result.status()).toBe(201)
  }
  await page.reload()
  const week = page.getByRole('region', { name: 'Неделя', exact: true })
  const title = page.getByTestId('calendar-period-title')
  const updating = page.getByRole('status', {
    name: 'Обновляем календарь',
    exact: true,
  })
  await expect(week).toBeVisible()
  await expect(updating).toBeHidden()
  await expect(
    week.getByRole('button', {
      name: 'Открыть задачу Задача календаря 0',
      exact: true,
    }),
  ).toHaveCount(1)
  await page.evaluate(async () => {
    await document.fonts.ready
  })

  let releaseReads = () => {}
  const pendingReads = new Promise<void>((resolve) => {
    releaseReads = resolve
  })
  const requests: string[] = []
  await page.route(
    (url) =>
      ['/api/v1/tasks/cursor', '/api/v1/self-care/plan'].includes(url.pathname),
    async (route) => {
      requests.push(route.request().url())
      await pendingReads
      await route.continue()
    },
  )
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.start')
  const samples: { before: string; after: string; elapsedMs: number }[] = []
  // Use native touch input, including pointer capture and browser gesture handling.
  for (const direction of [
    'left',
    'left',
    'left',
    'left',
    'left',
    'right',
    'right',
  ]) {
    const before = (await title.textContent())!
    const started = performance.now()
    const startX = direction === 'left' ? 315 : 95
    const endX = direction === 'left' ? 95 : 315
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: startX, y: 365 }],
    })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: endX, y: 367 }],
    })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    )
    samples.push({
      before,
      after: (await title.textContent())!,
      elapsedMs: performance.now() - started,
    })
  }
  const { profile } = await cdp.send('Profiler.stop')
  await writeFile(
    testInfo.outputPath('swipe.cpuprofile'),
    JSON.stringify(profile),
  )
  await testInfo.attach('swipe-timing', {
    body: JSON.stringify({ samples, requests }),
    contentType: 'application/json',
  })
  await writeFile(
    testInfo.outputPath('swipe-timing.json'),
    JSON.stringify({ samples, requests }),
  )
  await page.screenshot({
    path: testInfo.outputPath('pending-swipes.png'),
    fullPage: true,
  })
  expect
    .soft(samples.filter((sample) => sample.before !== sample.after))
    .toHaveLength(7)
  await expect.soft(title).toContainText(
    new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'short',
    }).format(new Date(`${addDateDays(weekStart, 21)}T12:00:00`)),
  )
  await expect.soft(page.getByRole('dialog')).toHaveCount(0)
  releaseReads()
  await expect(updating).toBeHidden()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  expect(errors).toEqual([])
})
