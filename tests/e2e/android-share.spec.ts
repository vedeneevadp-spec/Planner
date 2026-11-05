import { generateUuidV7 } from '@planner/contracts'
import { expect, type Page, test } from '@playwright/test'

import type { IncomingShare } from '../../apps/web/src/features/android-share/native-incoming-shares'

declare global {
  interface Window {
    __shareTest: {
      acknowledged: string[]
      enqueue(share: IncomingShare): void
    }
  }
}

const productUrl = 'https://shop.example/item/termos-350?color=blue'

async function installShareBridge(page: Page, first: IncomingShare) {
  await page.addInitScript((initial: IncomingShare) => {
    const queueKey = 'test-android-share-queue'
    if (sessionStorage.getItem(queueKey) === null) {
      sessionStorage.setItem(queueKey, JSON.stringify([initial]))
    }
    const readQueue = (): IncomingShare[] =>
      JSON.parse(sessionStorage.getItem(queueKey) ?? '[]') as IncomingShare[]
    let listener: (() => void) | undefined
    const acknowledged: string[] = []
    Object.assign(window, {
      __shareTest: {
        acknowledged,
        enqueue(share: IncomingShare) {
          sessionStorage.setItem(
            queueKey,
            JSON.stringify([...readQueue(), share]),
          )
          listener?.()
        },
      },
      CapacitorCustomPlatform: { name: 'android' },
      Capacitor: {
        nativeCallback(
          plugin: string,
          method: string,
          options: Record<string, string>,
          callback: () => void,
        ) {
          if (
            plugin === 'PlannerIncomingShares' &&
            method === 'addListener' &&
            options.eventName === 'pendingShare'
          )
            listener = callback
          return 'test-listener'
        },
        nativePromise(
          plugin: string,
          method: string,
          options: Record<string, string> = {},
        ) {
          if (plugin === 'PlannerCalendarEvents')
            return Promise.resolve({ event: null })
          if (plugin === 'PlannerIncomingShares') {
            if (method === 'acknowledgeShare') {
              acknowledged.push(options.requestId!)
              sessionStorage.setItem(
                queueKey,
                JSON.stringify(
                  readQueue().filter(
                    ({ requestId }) => requestId !== options.requestId,
                  ),
                ),
              )
            }
            return Promise.resolve({ share: readQueue()[0] ?? null })
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
            name: 'PlannerIncomingShares',
            methods: ['readPendingShare', 'acknowledgeShare', 'removeListener']
              .map((name) => ({ name, rtype: 'promise' }))
              .concat([{ name: 'addListener', rtype: 'callback' }]),
          },
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
  }, first)
}

test.use({
  viewport: { width: 390, height: 844 },
  locale: 'ru-RU',
  timezoneId: 'Asia/Novosibirsk',
})

test('receives a message before login and saves a product link to the chosen workspace after confirmation', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const message: IncomingShare = {
    requestId: generateUuidV7(),
    subject: '',
    text: 'Забрать посылку до пятницы',
  }
  const product: IncomingShare = {
    requestId: generateUuidV7(),
    subject: 'Термокружка, 350 мл',
    text: productUrl,
  }
  const cancelled: IncomingShare = {
    requestId: generateUuidV7(),
    subject: '',
    text: 'Черновик для отмены',
  }
  await installShareBridge(page, message)
  const writes = { tasks: 0, purchases: 0 }
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    const path = new URL(request.url()).pathname
    if (path === '/api/v1/tasks') writes.tasks++
    if (path === '/api/v1/chaos-inbox') writes.purchases++
  })
  const dialog = page.getByRole('dialog', { name: 'Что добавить?' })
  await page.goto('/today')
  await page
    .getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' })
    .click()
  await expect(dialog).toHaveCount(0)
  await page.getByLabel('Имя').fill('Проверка обмена')
  await page
    .getByLabel('Email')
    .fill(`android-share-${message.requestId}@example.test`)
  await page.getByLabel('Пароль', { exact: true }).fill('e2e-password')
  await page.getByLabel('Подтвердите пароль').fill('e2e-password')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(dialog.getByLabel('Название')).toHaveValue(message.text)
  await expect(
    dialog.getByRole('button', { name: 'Задачу', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByLabel('Название').fill('Забрать заказ')
  await dialog.getByLabel('Срок').fill('2027-01-08')
  await page.screenshot({ path: testInfo.outputPath('shared-task-draft.png') })
  expect(writes).toEqual({ tasks: 0, purchases: 0 })
  const taskSaved = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === '/api/v1/tasks',
  )
  await dialog.getByRole('button', { name: 'Добавить задачу' }).click()
  const task = await taskSaved
  expect(task.ok()).toBe(true)
  expect(await task.json()).toMatchObject({
    id: message.requestId,
    title: 'Забрать заказ',
    note: message.text,
    dueDate: '2027-01-08',
    plannedDate: null,
  })
  await expect(dialog).toBeHidden()
  await expect
    .poll(() => page.evaluate(() => window.__shareTest.acknowledged))
    .toContain(message.requestId)

  // Seed a second real workspace for this synthetic account.
  const observed = await task.request().allHeaders()
  const headers = Object.fromEntries(
    ['authorization', 'x-workspace-id', 'x-actor-user-id'].flatMap((key) =>
      observed[key] ? [[key, observed[key]]] : [],
    ),
  )
  const api = new URL(task.url()).origin
  const familyName = 'Семья для покупок'
  const familyResponse = await page.request.post(
    api + '/api/v1/workspaces/shared',
    { headers, data: { name: familyName } },
  )
  expect(familyResponse.ok()).toBe(true)
  const family = (await familyResponse.json()) as { id: string }
  await page.goto('/shopping')
  await expect(page.getByPlaceholder('Добавить покупку')).toBeVisible()
  const familyTask: IncomingShare = {
    requestId: generateUuidV7(),
    subject: '',
    text: 'Проверить заказ для семьи',
  }
  await page.evaluate((s) => window.__shareTest.enqueue(s), familyTask)
  await expect(dialog.getByLabel('Пространство')).toHaveValue(
    observed['x-workspace-id']!,
  )
  await dialog.getByLabel('Название').fill('Проверить семейный заказ')
  await dialog.getByLabel('Пространство').selectOption(family.id)
  const taskEndpoint = api + '/api/v1/tasks'
  await page.route(taskEndpoint, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({
      status: 503,
      json: { message: 'Service unavailable' },
    })
  })
  await dialog.getByRole('button', { name: 'Добавить задачу' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Не удалось сохранить')
  await expect(dialog.getByLabel('Название')).toHaveValue(
    'Проверить семейный заказ',
  )
  await expect(dialog.getByLabel('Пространство')).toHaveValue(family.id)
  expect(
    await page.evaluate(() => window.__shareTest.acknowledged),
  ).not.toContain(familyTask.requestId)
  await page.unroute(taskEndpoint)
  const retry = page.waitForResponse(
    (r) => r.url() === taskEndpoint && r.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Добавить задачу' }).click()
  const retriedTask = await retry
  expect(retriedTask.ok()).toBe(true)
  expect((await retriedTask.request().allHeaders())['x-workspace-id']).toBe(
    family.id,
  )
  expect(await retriedTask.json()).toMatchObject({
    id: familyTask.requestId,
    title: 'Проверить семейный заказ',
    note: familyTask.text,
  })
  await expect(dialog).toBeHidden()
  await expect
    .poll(() => page.evaluate(() => window.__shareTest.acknowledged))
    .toContain(familyTask.requestId)

  await page.evaluate((s) => window.__shareTest.enqueue(s), product)
  await expect(dialog.getByLabel('Название')).toHaveValue(product.subject)
  await expect(
    dialog.getByRole('button', { name: 'Покупку', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByText(productUrl, { exact: true })).toBeVisible()
  await dialog.getByLabel('Название').fill('Кружка в дорогу')
  await dialog.getByLabel('Категория').selectOption('household')
  await dialog.getByLabel('Пространство').selectOption(family.id)
  expect(writes.purchases).toBe(0)
  await page.screenshot({
    path: testInfo.outputPath('shared-purchase-draft.png'),
  })
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === '/api/v1/chaos-inbox',
  )
  await dialog.getByRole('button', { name: 'Добавить покупку' }).click()
  const purchase = await saved
  expect(purchase.ok()).toBe(true)
  expect((await purchase.request().allHeaders())['x-workspace-id']).toBe(
    family.id,
  )
  expect(await purchase.json()).toMatchObject({
    items: [
      {
        id: product.requestId,
        text: 'Кружка в дорогу',
        productUrl,
        shoppingCategory: 'household',
      },
    ],
  })
  await expect(dialog).toBeHidden()
  await expect
    .poll(() => page.evaluate(() => window.__shareTest.acknowledged))
    .toContain(product.requestId)
  const active = page.getByRole('region', { name: 'Актуальные покупки' })
  await page.reload()
  const switcher = page
    .locator('header button[aria-haspopup="listbox"]:visible')
    .first()
  await expect(switcher).toBeEnabled()
  if (!(await switcher.textContent())?.includes(familyName)) {
    await switcher.click()
    await page.getByRole('option', { name: familyName }).click()
  }
  await expect(
    active.getByText('Кружка в дорогу', { exact: true }),
  ).toBeVisible()
  const productLink = active.getByRole('link', {
    name: 'Открыть товар: Кружка в дорогу',
  })
  await expect(productLink).toHaveAttribute('href', productUrl)
  await page.reload()
  await expect(productLink).toHaveAttribute('href', productUrl)
  const repeatedProduct = { ...product, requestId: generateUuidV7() }
  await page.evaluate((s) => window.__shareTest.enqueue(s), repeatedProduct)
  await expect(dialog.getByLabel('Название')).toHaveValue(
    repeatedProduct.subject,
  )
  await dialog.getByRole('button', { name: 'Добавить покупку' }).click()
  await expect(dialog).toBeHidden()
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Уже в списке — Кружка в дорогу' }),
  ).toContainText(familyName)
  await expect
    .poll(() => page.evaluate(() => window.__shareTest.acknowledged))
    .toContain(repeatedProduct.requestId)
  await expect(active.getByRole('link', { name: /Открыть товар/ })).toHaveCount(
    1,
  )
  expect(writes.purchases).toBe(1)
  await page.evaluate((s) => window.__shareTest.enqueue(s), cancelled)
  await expect(dialog.getByLabel('Название')).toHaveValue(cancelled.text)
  await dialog.getByRole('button', { name: 'Отмена' }).click()
  await expect(dialog).toBeHidden()
  await expect
    .poll(() => page.evaluate(() => window.__shareTest.acknowledged))
    .toContain(cancelled.requestId)
  // First personal task, failed shared task, successful retry, and a single purchase.
  expect(writes).toEqual({ tasks: 3, purchases: 1 })
  expect(errors).toEqual([])
})
