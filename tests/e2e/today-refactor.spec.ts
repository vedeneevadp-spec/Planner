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
