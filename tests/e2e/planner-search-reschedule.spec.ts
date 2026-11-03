import AxeBuilder from '@axe-core/playwright'
import { addDateDays } from '@planner/contracts'
import { expect, test } from '@playwright/test'

test.use({
  extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.14' },
  timezoneId: 'UTC',
})

test('previews load, reschedules and undoes, then searches historical records on desktop and mobile', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/today')
  await page.getByRole('tab', { name: 'Регистрация' }).click()
  await page.getByLabel('Имя').fill('Проверка Планнера')
  await page
    .getByLabel('Email')
    .fill(`planner-search-${Date.now()}@example.test`)
  await page.getByLabel('Пароль', { exact: true }).fill('e2e-password')
  await page.getByLabel('Подтвердите пароль').fill('e2e-password')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByRole('button', { name: 'Новая задача', exact: true }).click()
  const composer = page.getByRole('dialog', { name: 'Новая задача' })
  await composer
    .getByRole('textbox', { name: 'Задача' })
    .fill('Разобрать документы')
  await composer
    .getByRole('group', { name: 'Ресурс' })
    .getByRole('button', { name: 'Расход 4' })
    .click()
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/tasks' &&
      response.status() === 201,
  )
  await composer.getByRole('button', { name: 'Добавить задачу' }).click()
  const response = await created
  const first = (await response.json()) as { id: string; plannedDate: string }
  const request = response.request()
  const observed = await request.allHeaders()
  const headers = Object.fromEntries(
    [
      'authorization',
      'x-workspace-id',
      'x-actor-user-id',
      'x-client-timezone',
      'x-forwarded-for',
    ].flatMap((key) => (observed[key] ? [[key, observed[key]]] : [])),
  )
  const base = new URL(request.url()).origin
  const payload = request.postDataJSON() as Record<string, unknown>
  delete payload.id
  const tomorrow = addDateDays(first.plannedDate, 1)
  const target = addDateDays(first.plannedDate, 2)
  for (const [title, resource, plannedDate] of [
    ['Подготовить материалы', -3, first.plannedDate],
    ['Отправить посылку', -2, first.plannedDate],
    ['Большой проект', -4, tomorrow],
    ['Рабочая встреча', -4, tomorrow],
  ]) {
    const result = await page.request.post(base + '/api/v1/tasks', {
      headers,
      data: { ...payload, title, resource, plannedDate },
    })
    expect(result.status(), await result.text()).toBe(201)
  }
  const old = await page.request.post(base + '/api/v1/tasks', {
    headers,
    data: {
      ...payload,
      title: 'Согласовать договор',
      note: 'Номер договора 123. Полная заметка сохранена и доступна после завершения.',
      plannedDate: '2020-01-01',
      resource: 0,
    },
  })
  expect(old.status()).toBe(201)
  const oldTask = (await old.json()) as { id: string; version: number }
  const completed = await page.request.patch(
    `${base}/api/v1/tasks/${oldTask.id}/status`,
    { headers, data: { status: 'done', expectedVersion: oldTask.version } },
  )
  expect(completed.ok()).toBe(true)
  const shopping = await page.request.post(base + '/api/v1/chaos-inbox', {
    headers,
    data: {
      items: [
        {
          kind: 'shopping',
          text: 'Папка для договоров',
          shoppingCategory: 'other',
        },
      ],
    },
  })
  expect(shopping.status()).toBe(201)
  await expect(
    page.getByRole('complementary', { name: 'Несинхронизированные изменения' }),
  ).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Открыть антиперегруз' }).click()
  await page.getByRole('button', { name: 'Подобрать день' }).first().click()
  const picker = page.getByRole('dialog', { name: 'Куда перенести?' })
  await expect(picker.getByText('Подходит', { exact: true })).toBeVisible()
  await expect(picker.locator('input:checked')).toHaveValue(target)
  await expect(
    picker.getByText('Сегодня станет 5 из 8. В выбранный день — 4 из 8.'),
  ).toBeVisible()
  expect(
    (await new AxeBuilder({ page }).include('dialog').analyze()).violations,
  ).toEqual([])
  expect(
    (
      (await (
        await page.request.get(`${base}/api/v1/tasks/${first.id}`, { headers })
      ).json()) as { plannedDate: string }
    ).plannedDate,
  ).toBe(first.plannedDate)
  for (const viewport of [
    { width: 1360, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(picker).toBeVisible()
    await expect(
      picker.getByRole('button', { name: /^Перенести на/ }),
    ).toBeInViewport({ ratio: 1 })
    expect(
      await picker.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`reschedule-${viewport.width}.png`),
      fullPage: true,
    })
  }
  await picker.getByRole('button', { name: /^Перенести на/ }).click()
  const undo = page.getByRole('button', { name: 'Отменить', exact: true })
  await expect(undo).toBeVisible()
  await expect
    .poll(
      async () =>
        (
          (await (
            await page.request.get(`${base}/api/v1/tasks/${first.id}`, {
              headers,
            })
          ).json()) as { plannedDate: string }
        ).plannedDate,
    )
    .toBe(target)
  await undo.click()
  await expect
    .poll(
      async () =>
        (
          (await (
            await page.request.get(`${base}/api/v1/tasks/${first.id}`, {
              headers,
            })
          ).json()) as { plannedDate: string }
        ).plannedDate,
    )
    .toBe(first.plannedDate)
  await page
    .getByRole('button', { name: 'Поиск по Планнеру', exact: true })
    .click()
  const search = page.getByRole('dialog', { name: 'Поиск по Планнеру' })
  await expect(search.getByRole('searchbox')).toBeFocused()
  await search.getByRole('searchbox').fill('договор')
  await expect(
    search.getByRole('button', { name: /Согласовать договор/ }),
  ).toBeVisible()
  await expect(
    search.getByRole('button', { name: /Папка для договоров/ }),
  ).toBeVisible()
  expect(
    (await new AxeBuilder({ page }).include('dialog').analyze()).violations,
  ).toEqual([])
  for (const viewport of [
    { width: 1360, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(viewport)
    expect(
      await search.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`search-${viewport.width}.png`),
      fullPage: true,
    })
  }
  await search.getByRole('button', { name: /Согласовать договор/ }).click()
  const detail = page.getByRole('dialog', { name: 'Согласовать договор' })
  await expect(detail.getByText(/Полная заметка сохранена/)).toBeVisible()
  await detail.getByRole('button', { name: '← К результатам' }).click()
  await search.getByRole('checkbox', { name: 'Включать выполненные' }).uncheck()
  await expect(
    search.getByRole('button', { name: /Согласовать договор/ }),
  ).toHaveCount(0)
  await search.getByRole('button', { name: 'Покупки', exact: true }).click()
  await expect(
    search.getByRole('button', { name: /Папка для договоров/ }),
  ).toBeVisible()
  await page.context().setOffline(true)
  await search.getByRole('searchbox').fill('папка')
  await expect(search.getByText('Поиск временно недоступен')).toBeVisible()
  await page.context().setOffline(false)
  await expect(
    search.getByRole('button', { name: /Папка для договоров/ }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(search).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Поиск по Планнеру', exact: true }),
  ).toBeFocused()
  await expect(
    page.getByRole('button', { name: 'Показать задачи списком' }),
  ).toBeInViewport({ ratio: 1 })
  for (const path of ['/calendar', '/shopping', '/cleaning', '/self-care']) {
    await page.goto(path)
    const button = page.getByRole('button', {
      name: 'Поиск по Планнеру',
      exact: true,
    })
    await expect(button).toBeInViewport({ ratio: 1 })
    await button.click()
    await expect(
      page.getByRole('dialog', { name: 'Поиск по Планнеру' }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
  }
  expect(errors).toEqual([])
})
