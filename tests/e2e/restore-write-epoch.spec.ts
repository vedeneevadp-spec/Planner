import { randomUUID } from 'node:crypto'

import { generateUuidV7 } from '@planner/contracts'
import { expect, test } from '@playwright/test'

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.17' } })

test('rejects delayed browser writes after real restore; reload permits new intent', async ({
  page,
}, testInfo) => {
  await page.goto('/today')
  await page.getByRole('tab', { name: 'Регистрация' }).click()
  await page.getByLabel('Имя').fill('Restore epoch')
  await page.getByLabel('Email').fill(`restore-${randomUUID()}@example.test`)
  await page.getByLabel('Пароль', { exact: true }).fill('e2e-password')
  await page.getByLabel('Подтвердите пароль').fill('e2e-password')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByRole('button', { name: 'Новая задача', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Задача', exact: true })
    .fill('Сохранённая задача')
  const created = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === '/api/v1/tasks',
  )
  await page
    .getByRole('button', { name: 'Добавить задачу', exact: true })
    .click()
  const createResponse = await created
  expect(createResponse.status()).toBe(201)
  const original = createResponse.request()
  const observed = await original.allHeaders()
  const headers = Object.fromEntries(
    [
      'authorization',
      'x-workspace-id',
      'x-workspace-epoch',
      'x-workspace-epochs',
      'x-actor-user-id',
      'x-client-timezone',
      'x-forwarded-for',
      'content-type',
    ].flatMap((key) => (observed[key] ? [[key, observed[key]]] : [])),
  )
  const base = new URL(original.url()).origin
  const payload = original.postDataJSON() as Record<string, unknown>
  const exported = await page.request.get(`${base}/api/v1/backups/export`, {
    headers,
  })
  expect(exported.status(), await exported.text()).toBe(200)
  const archive = (await exported.json()) as Record<string, unknown>
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let intercepted = false
  await page.route('**/api/v1/tasks', async (route) => {
    if (route.request().method() === 'POST') {
      intercepted = true
      await gate
    }
    await route.continue()
  })
  const late = page.evaluate(
    async ({ base, headers, payload }) => {
      const response = await fetch(`${base}/api/v1/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })
      return {
        status: response.status,
        body: (await response.json()) as { error: { code: string } },
      }
    },
    {
      base,
      headers,
      payload: { ...payload, id: generateUuidV7(), title: 'Поздняя запись' },
    },
  )
  await expect.poll(() => intercepted).toBe(true)
  const restoreData = {
    archive,
    confirmation: 'RESTORE_PERSONAL_BACKUP',
    restoreProfile: true,
    restoreWorkspaceSettings: true,
  }
  const key = randomUUID()
  try {
    const restored = await page.request.post(
      `${base}/api/v1/backups/import/restore`,
      { headers: { ...headers, 'idempotency-key': key }, data: restoreData },
    )
    expect(restored.status(), await restored.text()).toBe(200)
  } finally {
    release()
  }
  const rejected = await late
  expect(rejected.status).toBe(409)
  expect(rejected.body.error.code).toBe('workspace_restored')
  await page.unroute('**/api/v1/tasks')
  const replay = await page.request.post(
    `${base}/api/v1/backups/import/restore`,
    { headers: { ...headers, 'idempotency-key': key }, data: restoreData },
  )
  expect(replay.status(), await replay.text()).toBe(200)
  const secondOldRestore = await page.request.post(
    `${base}/api/v1/backups/import/restore`,
    {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data: restoreData,
    },
  )
  expect(secondOldRestore.status()).toBe(409)
  const session = await page.request.get(`${base}/api/v1/session`, { headers })
  expect(session.headers()['x-workspace-epoch']).toBe('1')
  await page.reload()
  await page.getByRole('button', { name: 'Новая задача', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Задача', exact: true })
    .fill('Новая запись после восстановления')
  const fresh = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === '/api/v1/tasks',
  )
  await page
    .getByRole('button', { name: 'Добавить задачу', exact: true })
    .click()
  const freshResponse = await fresh
  expect(freshResponse.status(), await freshResponse.text()).toBe(201)
  expect(
    (await freshResponse.request().allHeaders())['x-workspace-epoch'],
  ).toBe('1')

  const personalId = headers['x-workspace-id']!
  const personalHeaders = {
    ...headers,
    'x-workspace-epoch': '1',
    'x-workspace-epochs': JSON.stringify({ [personalId]: '1' }),
  }
  const shared = await page.request.post(`${base}/api/v1/workspaces/shared`, {
    headers: personalHeaders,
    data: { name: 'После восстановления' },
  })
  expect(shared.status(), await shared.text()).toBe(201)
  const sharedId = ((await shared.json()) as { id: string }).id
  const sharedHeaders = {
    ...headers,
    'x-workspace-id': sharedId,
    'x-workspace-epoch': '0',
  }
  const sharedSession = await page.request.get(`${base}/api/v1/session`, {
    headers: sharedHeaders,
  })
  expect(sharedSession.status(), await sharedSession.text()).toBe(200)
  const scopeHeader = sharedSession.headers()['x-workspace-epochs']!
  expect(JSON.parse(scopeHeader) as unknown).toEqual({
    [personalId]: '1',
    [sharedId]: '0',
  })
  const currentSharedHeaders = {
    ...sharedHeaders,
    'x-workspace-epochs': scopeHeader,
  }
  const sharedTask = await page.request.post(`${base}/api/v1/tasks`, {
    headers: currentSharedHeaders,
    data: {
      ...payload,
      id: generateUuidV7(),
      title: 'Перенос после восстановления',
    },
  })
  expect(sharedTask.status(), await sharedTask.text()).toBe(201)
  const task = (await sharedTask.json()) as { id: string; version: number }
  const staleHeaders = {
    ...sharedHeaders,
    'x-workspace-epochs': JSON.stringify({
      [personalId]: '0',
      [sharedId]: '0',
    }),
  }
  const copyUrl = `${base}/api/v1/tasks/${task.id}/copy-to-personal`
  const staleCopy = await page.request.post(copyUrl, {
    headers: staleHeaders,
    data: { expectedVersion: task.version },
  })
  expect(staleCopy.status(), await staleCopy.text()).toBe(409)
  const copied = await page.request.post(copyUrl, {
    headers: currentSharedHeaders,
    data: { expectedVersion: task.version },
  })
  expect(copied.status(), await copied.text()).toBe(200)
  expect(((await copied.json()) as { workspaceId: string }).workspaceId).toBe(
    personalId,
  )
  const staleProfile = await page.request.patch(`${base}/api/v1/profile`, {
    headers: staleHeaders,
    data: { displayName: 'Старое имя' },
  })
  expect(staleProfile.status(), await staleProfile.text()).toBe(409)
  const freshProfile = await page.request.patch(`${base}/api/v1/profile`, {
    headers: currentSharedHeaders,
    data: { displayName: 'Новое имя' },
  })
  expect(freshProfile.status(), await freshProfile.text()).toBe(200)
  await page.goto('/more')
  await expect(
    page.getByRole('button', { name: 'Сохранить старые изменения привычек' }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Сохранить старые изменения привычек' })
    .click()
  await expect(
    page.getByText(
      'Несинхронизированных изменений старых привычек на этом устройстве нет.',
    ),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('restore-and-recovery.png'),
    fullPage: true,
  })
})
