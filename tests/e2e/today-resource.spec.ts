import { expect, type Page, test, type TestInfo } from '@playwright/test'

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.14' } })

interface ApiTask {
  id: string
  resource: number | null
  title: string
  version: number
}

async function captureResourceState(
  page: Page,
  testInfo: TestInfo,
  state: string,
) {
  await expect(
    page.getByRole('complementary', { name: 'Несинхронизированные изменения' }),
  ).toHaveCount(0)
  for (const viewport of [
    { name: 'desktop', width: 1360, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page
      .getByRole('region', { name: 'Антиперегруз' })
      .scrollIntoViewIfNeeded()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`td10-${state}-${viewport.name}.png`),
      animations: 'disabled',
      fullPage: true,
    })
  }
  await page.setViewportSize({ width: 1360, height: 900 })
}

async function expandResourcePanel(page: Page) {
  const panel = page.getByRole('region', { name: 'Антиперегруз' })
  await expect(panel).toBeVisible()
  const expand = panel.getByRole('button', { name: 'Открыть антиперегруз' })
  if (await expand.count()) await expand.click()
  return panel
}

async function waitForTaskQueueCompletion(
  page: Page,
  headers: Record<string, string>,
) {
  // HTTP success precedes durable command removal. Wait for normal sync before
  // reload; abrupt replay recovery is separate from resource persistence.
  const workspaceId = headers['x-workspace-id']
  if (!workspaceId) throw new Error('Missing synthetic workspace header')
  await expect
    .poll(() =>
      page.evaluate(
        (workspaceId) =>
          new Promise<number>((resolve, reject) => {
            const request = indexedDB.open('planner-offline')
            request.onerror = () =>
              reject(
                new Error(
                  request.error?.message ?? 'Could not open task queue',
                ),
              )
            request.onsuccess = () => {
              const db = request.result
              const transaction = db.transaction('mutationQueue', 'readonly')
              const rows = transaction.objectStore('mutationQueue').getAll()
              rows.onerror = () =>
                reject(
                  new Error(rows.error?.message ?? 'Could not read task queue'),
                )
              rows.onsuccess = () =>
                resolve(
                  (
                    rows.result as Array<{
                      workspaceId: string
                    }>
                  ).filter((row) => row.workspaceId === workspaceId).length,
                )
              transaction.oncomplete = () => db.close()
              transaction.onerror = () => {
                db.close()
                reject(
                  new Error(
                    transaction.error?.message ??
                      'Task queue transaction failed',
                  ),
                )
              }
            }
          }),
        workspaceId,
      ),
    )
    .toBe(0)
}

test('keeps unrated Today tasks unknown and counts only explicit resource ratings', async ({
  page,
}, testInfo) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const title = `Ресурс без оценки ${suffix}`
  const renderErrors: string[] = []
  page.on('pageerror', (error) => renderErrors.push(error.message))

  await page.goto('/today')
  await page.getByRole('tab', { name: 'Регистрация' }).click()
  await page.getByLabel('Имя').fill('Resource Regression User')
  await page
    .getByLabel('Email')
    .fill(`e2e-today-resource-${suffix}@example.test`)
  await page.getByLabel('Пароль', { exact: true }).fill('e2e-password')
  await page.getByLabel('Подтвердите пароль').fill('e2e-password')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page
    .getByRole('button', { name: 'Создать задачу', exact: true })
    .click()

  const composer = page.getByRole('dialog', { name: 'Новая задача' })
  await composer.getByRole('textbox', { name: 'Задача' }).fill(title)
  await expect(
    composer.getByRole('button', { name: 'Не указано', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  const createdResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/tasks' &&
      response.status() === 201,
  )
  await composer.getByRole('button', { name: 'Добавить задачу' }).click()
  const firstResponse = await createdResponse
  const first = (await firstResponse.json()) as ApiTask
  expect(first.resource).toBeNull()
  await expect(page.getByText(title, { exact: true })).toBeVisible()

  // Reuse only this synthetic user's authorization from the actual UI command.
  // Omit the first command's id so the API creates eleven independent tasks.
  const request = firstResponse.request()
  const observedHeaders = await request.allHeaders()
  const headers = Object.fromEntries(
    [
      'authorization',
      'x-workspace-id',
      'x-actor-user-id',
      'x-client-timezone',
      'x-forwarded-for',
    ].flatMap((key) =>
      observedHeaders[key] ? [[key, observedHeaders[key]]] : [],
    ),
  )
  const tasksUrl = request.url()
  const createPayload = request.postDataJSON() as Record<string, unknown>
  delete createPayload.id
  expect(createPayload.resource).toBeNull()
  expect(createPayload.plannedDate).toBeTruthy()
  const taskIds = [first.id]
  for (let index = 2; index <= 12; index += 1) {
    const response = await page.request.post(tasksUrl, {
      headers,
      data: { ...createPayload, title: `${title} ${index}` },
    })
    expect(response.status()).toBe(201)
    const task = (await response.json()) as ApiTask
    expect(task.resource).toBeNull()
    taskIds.push(task.id)
  }

  await waitForTaskQueueCompletion(page, headers)
  await page.reload()
  let panel = await expandResourcePanel(page)
  await expect(
    panel.getByText('Оценено 0 из 12', { exact: true }),
  ).toBeVisible()
  await expect(
    panel.getByText('неполная оценка', { exact: true }),
  ).toBeVisible()
  await expect(panel.getByText('Нагрузка неизвестна')).toBeVisible()
  await expect(
    panel.getByRole('group', { name: 'Ресурс на сегодня' }),
  ).toBeVisible()
  await expect(panel.getByText('спокойно', { exact: true })).toHaveCount(0)
  await expect(panel.getByText(/План.*(реалистич|укладывается)/)).toHaveCount(0)
  await captureResourceState(page, testInfo, 'unrated')

  await page
    .getByRole('button', { name: `Действия с задачей ${title}`, exact: true })
    .click()
  await page
    .getByRole('menuitem', { name: 'Редактировать', exact: true })
    .click()
  const edit = page.getByRole('dialog', { name: 'Редактировать задачу' })
  await expect(
    edit.getByRole('button', { name: 'Не указано', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await edit.getByRole('button', { name: 'Нейтрально', exact: true }).click()
  const editedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url() === `${tasksUrl}/${first.id}` &&
      response.ok(),
  )
  await edit
    .getByRole('button', { name: 'Сохранить', exact: true })
    .last()
    .click()
  expect(((await (await editedResponse).json()) as ApiTask).resource).toBe(0)
  await waitForTaskQueueCompletion(page, headers)
  await page.reload()
  panel = await expandResourcePanel(page)
  await expect(
    panel.getByText('Оценено 1 из 12', { exact: true }),
  ).toBeVisible()
  await expect(panel.getByText('Оценённая часть')).toBeVisible()
  await expect(panel.getByText('0 из 8 ресурса')).toBeVisible()
  await expect(panel.getByText('спокойно', { exact: true })).toHaveCount(0)
  await expect(panel.getByText(/План.*(реалистич|укладывается)/)).toHaveCount(0)
  await captureResourceState(page, testInfo, 'partial')

  for (const [index, taskId] of taskIds.entries()) {
    const response = await page.request.get(`${tasksUrl}/${taskId}`, {
      headers,
    })
    expect(response.ok()).toBe(true)
    const current = (await response.json()) as ApiTask
    expect(current.resource).toBe(index === 0 ? 0 : null)
    if (index === 0) continue
    const updated = await page.request.patch(`${tasksUrl}/${taskId}`, {
      headers,
      data: {
        ...createPayload,
        title: current.title,
        expectedVersion: current.version,
        resource: 0,
      },
    })
    expect(updated.ok()).toBe(true)
    expect(((await updated.json()) as ApiTask).resource).toBe(0)
  }
  await page.reload()
  panel = await expandResourcePanel(page)
  await expect(
    panel.getByText('Оценено 12 из 12', { exact: true }),
  ).toBeVisible()
  await expect(panel.getByText('спокойно', { exact: true })).toBeVisible()
  await expect(panel.getByText('Нагрузка задач')).toBeVisible()
  await expect(panel.getByText('0 из 8 ресурса')).toBeVisible()
  await captureResourceState(page, testInfo, 'complete')

  // Even twelve assessed cached tasks must not imply a complete load after a
  // failed server read. Inject the outage only into this browser's task reads.
  await page.route('**/api/v1/tasks/read-model?*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'temporary_outage',
          message: 'Temporary task read outage',
        },
      }),
    }),
  )
  await page.reload()
  panel = await expandResourcePanel(page)
  await expect(
    panel.getByText('Оценено 12 из 12 · по загруженным задачам', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(panel.getByText('неполная оценка')).toBeVisible()
  await expect(panel.getByText('Оценённая часть')).toBeVisible()
  await expect(
    panel.getByText(/В расчёте задачи с планом на сегодня/),
  ).toHaveCount(0)
  await expect(
    panel.getByText(/Список задач может быть неполным или устаревшим/),
  ).toHaveCount(0)
  await expect(panel.getByText('спокойно', { exact: true })).toHaveCount(0)
  await expect(panel.getByText(/План.*(реалистич|укладывается)/)).toHaveCount(0)
  await captureResourceState(page, testInfo, 'task-read-error')
  expect(renderErrors).toEqual([])
})
