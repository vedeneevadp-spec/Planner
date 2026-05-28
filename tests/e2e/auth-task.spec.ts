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

  await expect(
    page.getByRole('button', { name: 'Создать задачу' }),
  ).toBeVisible()
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

async function openTaskComposer(page: Page) {
  await page
    .getByRole('button', { exact: true, name: 'Создать задачу' })
    .or(page.getByRole('button', { exact: true, name: 'Новая задача' }))
    .first()
    .click()
}

async function openWorkspaceActions(page: Page) {
  const workspaceActionsButton = page.getByRole('button', {
    name: 'Действия с workspace',
  })

  await expect(workspaceActionsButton).toBeVisible()

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

  await openTaskComposer(page)
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
    await page.goto('/calendar?calendarView=day')
    await openTaskComposer(page)
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
  await expect(
    page.getByRole('button', { name: 'Создать задачу' }),
  ).toBeVisible()

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe(
      'Выйти из аккаунта? Текущая сессия на этом устройстве будет завершена.',
    )
    await dialog.accept()
  })
  await page.goto('/more')
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

  await page.goto('/more')
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

test('creates, marks, and completes a shopping item', async ({ page }) => {
  const user = createE2eUser('e2e-shopping')
  const itemTitle = `E2E milk ${user.suffix}`

  await registerUser({ ...user, page })

  await page.goto('/shopping')
  await page.getByPlaceholder('Добавить покупку').fill(itemTitle)
  await page.getByRole('button', { name: 'Выбрать вид: Продукты' }).click()
  await page.getByRole('button', { name: 'Добавить покупку' }).click()

  const activePanel = page.getByLabel('Актуальные покупки')

  await expect(activePanel.getByText(itemTitle)).toBeVisible()

  await page
    .getByRole('button', { name: `Пометить срочным: ${itemTitle}` })
    .click()
  await expect(
    page.getByRole('button', { name: `Снять срочность: ${itemTitle}` }),
  ).toHaveAttribute('aria-pressed', 'true')

  await activePanel.getByText(itemTitle).click()

  const completedPanel = page.getByLabel('Купленные покупки')

  await expect(completedPanel.getByText(itemTitle)).toBeVisible()
})

test('creates a habit and toggles it from the habits page', async ({
  page,
}) => {
  const user = createE2eUser('e2e-habit')
  const habitTitle = `E2E water ${user.suffix}`

  await registerUser({ ...user, page })

  await page.goto(
    `/habits?habitsAction=habit&habitsActionRequest=${user.suffix}`,
  )

  const dialog = page.getByRole('dialog', { name: 'Новая привычка' })

  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Привычка' }).fill(habitTitle)
  await dialog
    .getByRole('button', { name: 'Добавить привычку' })
    .first()
    .click()

  await expect(
    page.getByRole('heading', { name: habitTitle }).last(),
  ).toBeVisible()
  await page
    .getByRole('button', {
      name: `Поставить привычку ${habitTitle} на паузу`,
    })
    .click()
  await expect(
    page.getByRole('button', {
      name: `Возобновить привычку ${habitTitle}`,
    }),
  ).toBeVisible()
})

test('creates a cleaning zone with a task and completes it today', async ({
  page,
}) => {
  const user = createE2eUser('e2e-cleaning')
  const zoneTitle = `E2E zone ${user.suffix}`
  const taskTitle = `E2E wipe shelf ${user.suffix}`

  await registerUser({ ...user, page })

  await page.goto('/cleaning/settings')
  await page.getByRole('button', { name: 'Добавить зону' }).click()

  const zoneForm = page.locator('form').filter({
    has: page.getByPlaceholder('Новая зона'),
  })

  await zoneForm.getByPlaceholder('Новая зона').fill(zoneTitle)
  await zoneForm.getByRole('button', { name: 'Добавить' }).click()

  await expect(page.getByRole('heading', { name: zoneTitle })).toBeVisible()

  await page.getByRole('button', { name: 'Добавить задачу' }).last().click()
  await page.getByPlaceholder('Например: помыть холодильник').fill(taskTitle)
  await page.getByRole('button', { name: 'Создать' }).click()

  await expect(page.getByText(taskTitle)).toBeVisible()

  await page.goto('/cleaning')
  const cleaningTasks = page.locator('#cleaning-tasks')

  await expect(cleaningTasks.getByText(zoneTitle)).toBeVisible()
  await expect(cleaningTasks.getByText(taskTitle)).toBeVisible()

  await page
    .getByRole('button', {
      name: `Отметить «${taskTitle}» выполненной`,
    })
    .click()

  await expect(
    cleaningTasks.getByText('На сегодня всё отмечено.'),
  ).toBeVisible()
})
