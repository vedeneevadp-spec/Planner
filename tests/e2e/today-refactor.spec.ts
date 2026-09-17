import { expect, type Page, test } from '@playwright/test'

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.14' } })

function createE2eUser(prefix: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return {
    displayName: `${prefix} User`,
    email: `${prefix}-${suffix}@example.test`,
    password: 'e2e-password',
    suffix,
  }
}

async function registerUser({
  displayName,
  email,
  page,
  password,
}: {
  displayName: string
  email: string
  page: Page
  password: string
}) {
  await page.goto('/today')
  await page.getByRole('tab', { name: 'Регистрация' }).click()
  await page.getByLabel('Имя').fill(displayName)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByLabel('Подтвердите пароль').fill(password)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(
    page.getByRole('button', { name: 'Создать задачу' }),
  ).toBeVisible()
}

async function openTaskComposer(page: Page) {
  await page
    .getByRole('button', { exact: true, name: 'Создать задачу' })
    .or(page.getByRole('button', { exact: true, name: 'Новая задача' }))
    .first()
    .click()
}

async function createTodayTask(page: Page, title: string) {
  await openTaskComposer(page)

  const dialog = page.getByRole('dialog', { name: 'Новая задача' })

  await dialog.getByRole('textbox', { name: 'Задача' }).fill(title)
  await dialog.getByRole('button', { name: 'Добавить задачу' }).click()
  await expect(page.getByText(title)).toBeVisible()
}

async function openWorkspaceActions(page: Page) {
  const button = page.getByRole('button', { name: 'Действия с workspace' })

  await expect(button).toBeVisible()

  if ((await button.getAttribute('aria-expanded')) !== 'true') {
    await button.click()
  }
}

test('keeps the personal Today flow intact after the refactor', async ({
  page,
}) => {
  const user = createE2eUser('e2e-today-refactor')
  const tomorrowTask = `Перенести завтра ${user.suffix}`
  const completedTask = `Закрыть сегодня ${user.suffix}`

  await registerUser({ ...user, page })

  await expect(page.getByText('Антиперегруз')).toBeVisible()
  await createTodayTask(page, tomorrowTask)

  await page.goto('/today?taskView=list')
  await expect(page.getByText(tomorrowTask)).toBeVisible()

  await page.goto('/today')
  await expect(
    page.getByRole('button', { name: 'Показать задачи плитками' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Показать задачи плитками' }).click()

  await page
    .getByRole('button', { name: `Действия с задачей ${tomorrowTask}` })
    .click()
  const scheduleSaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      /^\/api\/v1\/tasks\/[^/]+\/schedule$/.test(
        new URL(response.url()).pathname,
      ) &&
      response.ok(),
  )
  await page.getByRole('menuitem', { name: 'На завтра' }).click()
  await scheduleSaved

  const tomorrowSection = page
    .getByRole('button', { exact: true, name: 'Завтра' })
    .locator('xpath=ancestor::section[1]')

  await expect(tomorrowSection.getByText(tomorrowTask)).toBeVisible()

  await createTodayTask(page, completedTask)

  const todaySection = page
    .getByRole('button', { exact: true, name: 'Сегодня' })
    .locator('xpath=ancestor::section[1]')

  await todaySection
    .getByRole('article')
    .filter({ hasText: completedTask })
    .getByRole('button', { name: 'Завершить задачу' })
    .click()

  const doneTodayToggle = page.getByRole('button', {
    exact: true,
    name: 'Выполнено сегодня',
  })

  await expect(doneTodayToggle).toBeVisible()

  if ((await doneTodayToggle.getAttribute('aria-expanded')) !== 'true') {
    await doneTodayToggle.click()
  }

  await expect(page.getByText(completedTask)).toBeVisible()

  await page.getByRole('button', { name: 'Открыть антиперегруз' }).click()
  const preferencesSaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === '/api/v1/preferences' &&
      response.ok(),
  )
  await page.getByRole('button', { name: /Минимум/ }).click()
  await preferencesSaved
  await page.reload()
  await page.getByRole('button', { name: 'Открыть антиперегруз' }).click()
  await expect(page.getByRole('button', { name: /Минимум/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('keeps shared Today free of personal resource and self-care blocks', async ({
  page,
}) => {
  const user = createE2eUser('e2e-today-shared')
  const workspaceName = `Today workspace ${user.suffix}`
  const taskTitle = `Общая задача ${user.suffix}`

  await registerUser({ ...user, page })

  await page.goto('/more')
  await openWorkspaceActions(page)
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.getByLabel('Название').fill(workspaceName)
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByRole('heading', { name: workspaceName })).toBeVisible()

  await page.goto('/today')

  await expect(page.getByText('Антиперегруз')).toHaveCount(0)
  await createTodayTask(page, taskTitle)
  await expect(page.getByText(taskTitle)).toBeVisible()
  await expect(
    page.getByRole('button', { exact: true, name: 'Сегодня' }),
  ).toBeVisible()
})

test('keeps Today tasks usable while supplementary sources fail and recover independently', async ({
  page,
}, testInfo) => {
  const user = createE2eUser('e2e-today-source-recovery')
  const taskTitle = `Доступная задача ${user.suffix}`
  const recoveredSources = new Set<string>()
  const failedSources = new Set<string>()

  function sourceKey(url: URL): string | null {
    if (
      url.pathname === '/api/v1/chaos-inbox' &&
      url.searchParams.get('kind') === 'shopping'
    ) {
      return 'shopping'
    }
    if (url.pathname === '/api/v1/cleaning/today') return 'cleaning'
    if (url.pathname === '/api/v1/self-care/dashboard') {
      return `care:${url.searchParams.get('date')}`
    }
    return null
  }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const key = sourceKey(new URL(request.url()))
    if (request.method() === 'GET' && key && !recoveredSources.has(key)) {
      failedSources.add(key)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Temporary source outage' }),
      })
      return
    }
    await route.continue()
  })

  await registerUser({ ...user, page })

  const labels = ['Покупки', 'Уборка', 'Забота на сегодня', 'Забота на завтра']
  for (const label of labels) {
    await expect(
      page.getByText(`${label}: не удалось загрузить данные`, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: `Повторить: ${label}`, exact: true }),
    ).toBeEnabled()
  }

  await createTodayTask(page, taskTitle)
  const task = page.getByRole('article').filter({ hasText: taskTitle })
  await expect(
    task.getByRole('button', { name: 'Завершить задачу' }),
  ).toBeEnabled()
  await page.screenshot({
    path: testInfo.outputPath('td09-source-errors.png'),
    fullPage: true,
  })

  const careKeys = [...failedSources]
    .filter((key) => key.startsWith('care:'))
    .sort()
  expect(careKeys).toHaveLength(2)
  const sources = [
    { key: 'shopping', label: labels[0]!, empty: 'Покупки: список пуст.' },
    {
      key: 'cleaning',
      label: labels[1]!,
      empty: 'Уборка: на сегодня задач нет.',
    },
    {
      key: careKeys[0]!,
      label: labels[2]!,
      empty: 'Забота на сегодня: активных задач нет.',
    },
    {
      key: careKeys[1]!,
      label: labels[3]!,
      empty: 'Забота на завтра: активных задач нет.',
    },
  ]

  for (const [index, source] of sources.entries()) {
    recoveredSources.add(source.key)
    const refreshed = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        sourceKey(new URL(response.url())) === source.key &&
        response.ok(),
    )
    await page
      .getByRole('button', { name: `Повторить: ${source.label}`, exact: true })
      .click()
    await refreshed
    await expect(page.getByText(source.empty, { exact: true })).toBeVisible()
    await expect(
      page.getByRole('button', {
        name: `Повторить: ${source.label}`,
        exact: true,
      }),
    ).toHaveCount(0)
    await expect(task).toBeVisible()
    for (const pending of sources.slice(index + 1)) {
      await expect(
        page.getByRole('button', {
          name: `Повторить: ${pending.label}`,
          exact: true,
        }),
      ).toBeVisible()
    }
  }

  await page.screenshot({
    path: testInfo.outputPath('td09-source-recovered.png'),
    fullPage: true,
  })
  const completed = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      /^\/api\/v1\/tasks\/[^/]+\/status$/.test(
        new URL(response.url()).pathname,
      ) &&
      response.ok(),
  )
  await task.getByRole('button', { name: 'Завершить задачу' }).click()
  await completed
  await expect(
    page.getByRole('button', { name: 'Выполнено сегодня', exact: true }),
  ).toBeVisible()
})
