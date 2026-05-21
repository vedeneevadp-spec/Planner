import { expect, type Page, test } from '@playwright/test'

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

  await expect(page.getByRole('button', { name: 'Новая задача' })).toBeVisible()
}

async function expectComposerLayout(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Новая задача' })
  const panel = dialog.locator('form')
  const heading = dialog.getByRole('heading', { name: 'Новая задача' })
  const titleField = dialog.getByRole('textbox', { name: 'Задача' })
  const planField = dialog.getByLabel('План')

  await expect(dialog).toBeVisible()
  await expect(titleField).toBeVisible()

  const [headingBox, titleBox, planBox, panelBox] = await Promise.all([
    heading.boundingBox(),
    titleField.boundingBox(),
    planField.boundingBox(),
    panel.boundingBox(),
  ])

  expect(headingBox).not.toBeNull()
  expect(titleBox).not.toBeNull()
  expect(planBox).not.toBeNull()
  expect(panelBox).not.toBeNull()

  if (!headingBox || !titleBox || !planBox || !panelBox) {
    return
  }

  expect(titleBox.y).toBeGreaterThan(headingBox.y + headingBox.height)
  expect(titleBox.y).toBeLessThan(planBox.y)
  expect(panelBox.x).toBeGreaterThanOrEqual(0)
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  )
}

async function openWorkspaceActions(page: Page) {
  const workspaceActionsButton = page.getByRole('button', {
    name: 'Действия с workspace',
  })

  if ((await workspaceActionsButton.getAttribute('aria-expanded')) !== 'true') {
    await workspaceActionsButton.click()
  }

  await expect(workspaceActionsButton).toHaveAttribute('aria-expanded', 'true')
}

test('registers a user and creates a task through the app shell', async ({
  page,
}) => {
  const user = createE2eUser('e2e-task')
  const taskTitle = `E2E task ${user.suffix}`
  const updatedTaskTitle = `${taskTitle} updated`

  await registerUser({ ...user, page })

  await page.getByRole('button', { name: 'Новая задача' }).click()
  const createTaskDialog = page.getByRole('dialog', { name: 'Новая задача' })

  await createTaskDialog
    .getByRole('textbox', { name: 'Задача' })
    .fill(taskTitle)
  await createTaskDialog
    .getByRole('button', { name: 'Добавить задачу' })
    .click()

  await expect(page.getByText(taskTitle)).toBeVisible()

  await page
    .getByRole('button', { name: `Действия с задачей ${taskTitle}` })
    .click()
  await page.getByRole('menuitem', { name: 'Редактировать' }).click()

  const editTaskDialog = page.getByRole('dialog')

  await editTaskDialog
    .getByRole('textbox', { name: 'Задача' })
    .fill(updatedTaskTitle)
  await editTaskDialog.getByRole('button', { name: 'Сохранить' }).click()

  await expect(page.getByText(updatedTaskTitle)).toBeVisible()

  await page.getByRole('button', { name: 'Завершить задачу' }).click()
  await page
    .getByRole('button', { name: `Действия с задачей ${updatedTaskTitle}` })
    .click()
  await page.getByRole('menuitem', { name: 'Удалить' }).click()

  await expect(page.getByText(updatedTaskTitle)).toBeHidden()
})

test('keeps task composer field layout stable on desktop and mobile', async ({
  page,
}) => {
  const user = createE2eUser('e2e-composer-layout')
  const consoleErrors: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message)
  })

  await registerUser({ ...user, page })

  for (const viewport of [
    { height: 1000, width: 1440 },
    { height: 844, width: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/timeline')
    await page.getByRole('button', { name: 'Новая задача' }).click()
    await expectComposerLayout(page)
    await page.getByRole('button', { exact: true, name: 'Закрыть' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Новая задача' }),
    ).toBeHidden()
  }

  expect(consoleErrors).toEqual([])
})

test('keeps auth after reload and exposes password reset after failed sign-in', async ({
  page,
}) => {
  const user = createE2eUser('e2e-auth')

  await registerUser({ ...user, page })

  await page.reload()
  await expect(page.getByRole('button', { name: 'Новая задача' })).toBeVisible()

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe(
      'Выйти из аккаунта? Текущая сессия на этом устройстве будет завершена.',
    )
    await dialog.accept()
  })
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('tab', { name: 'Вход' })).toBeVisible()

  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Пароль', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page.getByRole('alert')).toContainText(
    'Неверный email или пароль.',
  )

  await page.getByRole('button', { name: 'Забыли пароль?' }).click()

  await expect(
    page.getByText(`Письмо для восстановления отправлено на ${user.email}.`),
  ).toBeVisible()
})

test('creates a shared workspace and opens participant management', async ({
  page,
}) => {
  const user = createE2eUser('e2e-shared')
  const workspaceName = `E2E workspace ${user.suffix}`

  await registerUser({ ...user, page })

  await openWorkspaceActions(page)
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.getByLabel('Название').fill(workspaceName)
  await page.getByRole('button', { name: 'Создать', exact: true }).click()

  await expect(page.getByRole('heading', { name: workspaceName })).toBeVisible()
  await openWorkspaceActions(page)
  await expect(page.getByRole('button', { name: 'Участники' })).toBeVisible()

  await page.getByRole('button', { name: 'Участники' }).click()

  const participantsDialog = page.getByRole('dialog', {
    name: workspaceName,
  })

  await expect(participantsDialog).toBeVisible()
  await expect(
    participantsDialog.getByRole('heading', {
      name: 'Пригласить участника',
    }),
  ).toBeVisible()
})
