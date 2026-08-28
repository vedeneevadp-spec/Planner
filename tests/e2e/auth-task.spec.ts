import { expect, type Page, test } from '@playwright/test'

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.12' } })

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
  const doneTodayToggle = page.getByRole('button', {
    exact: true,
    name: 'Выполнено сегодня',
  })

  await expect(doneTodayToggle).toBeVisible()

  if ((await doneTodayToggle.getAttribute('aria-expanded')) !== 'true') {
    await doneTodayToggle.click()
  }

  const doneTodaySection = doneTodayToggle.locator('xpath=ancestor::section[1]')

  await expect(
    doneTodaySection.getByText(updatedTaskTitle, { exact: true }),
  ).toBeVisible()
  await doneTodaySection
    .getByRole('button', { name: `Действия с задачей ${updatedTaskTitle}` })
    .click()
  await doneTodaySection.getByRole('menuitem', { name: 'Удалить' }).click()

  await expect(page.getByText(updatedTaskTitle)).toBeHidden()
})

test('keeps desktop chain notification actions clickable', async ({ page }) => {
  const user = createE2eUser('e2e-task-chain-notice')
  const taskTitle = `E2E chain task ${user.suffix}`

  await registerUser({ ...user, page })
  await openTaskComposer(page)

  const createTaskDialog = page.getByRole('dialog', { name: 'Новая задача' })
  await createTaskDialog
    .getByRole('textbox', { name: 'Задача' })
    .fill(taskTitle)
  await createTaskDialog
    .getByRole('button', { name: 'Добавить задачу' })
    .click()

  await page
    .getByRole('button', { name: `Действия с задачей ${taskTitle}` })
    .click()
  await page
    .getByRole('menuitem', { exact: true, name: 'Создать следующий этап' })
    .click()

  const nextStageDialog = page.getByRole('dialog', {
    name: 'Создать следующий этап',
  })
  await nextStageDialog.getByRole('button', { name: 'Создать' }).click()

  const notification = page.getByRole('status')
  await expect(notification).toContainText('Следующий этап создан')
  await notification
    .getByRole('button', { name: 'Закрыть уведомление' })
    .click()
  await expect(notification).toBeHidden()

  const firstStageCard = page
    .getByRole('article')
    .filter({ hasText: taskTitle })
    .filter({ hasText: '1/2' })
  await expect(firstStageCard).toBeVisible()
  await firstStageCard.getByRole('button', { name: 'Завершить задачу' }).click()
  await expect(notification).toContainText('Этап выполнен')

  await notification
    .getByRole('button', { name: 'Создать следующий этап' })
    .click()
  await expect(nextStageDialog).toBeVisible()
  await nextStageDialog.getByRole('button', { name: 'Закрыть' }).last().click()

  const chainCloseResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /^\/api\/v1\/tasks\/[^/]+\/chain\/close$/.test(
        new URL(response.url()).pathname,
      ),
  )
  await notification.getByRole('button', { name: 'Завершить цепочку' }).click()
  expect((await chainCloseResponse).ok()).toBe(true)
  await expect(notification).toContainText('Цепочка завершена')
  await notification
    .getByRole('button', { name: 'Закрыть уведомление' })
    .click()
  await expect(notification).toBeHidden()
})

test('creates and edits one task offline despite repeated submits', async ({
  context,
  page,
}) => {
  const user = createE2eUser('e2e-task-offline-submit')
  const taskTitle = `E2E offline task ${user.suffix}`
  const updatedTaskTitle = `${taskTitle} updated`

  await registerUser({ ...user, page })
  await openTaskComposer(page)
  await expect(page.getByRole('dialog', { name: 'Новая задача' })).toBeVisible()
  await page.getByRole('button', { exact: true, name: 'Закрыть' }).click()
  await context.setOffline(true)
  await openTaskComposer(page)

  const createDialog = page.getByRole('dialog', { name: 'Новая задача' })
  await createDialog.getByRole('textbox', { name: 'Задача' }).fill(taskTitle)

  await createDialog.locator('form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit()
    form.requestSubmit()
  })

  await expect(createDialog).toBeHidden({ timeout: 2_000 })
  await expect(page.getByText(taskTitle, { exact: true })).toHaveCount(1)

  await page
    .getByRole('button', { name: `Действия с задачей ${taskTitle}` })
    .click()
  await page.getByRole('menuitem', { name: 'Редактировать' }).click()

  const editDialog = page.getByRole('dialog', {
    name: 'Редактировать задачу',
  })
  await editDialog
    .getByRole('textbox', { name: 'Задача' })
    .fill(updatedTaskTitle)
  await editDialog.locator('form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit()
    form.requestSubmit()
  })

  await expect(editDialog).toBeHidden({ timeout: 2_000 })
  await expect(page.getByText(taskTitle, { exact: true })).toHaveCount(0)
  await expect(page.getByText(updatedTaskTitle, { exact: true })).toHaveCount(1)

  const createSynced = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/tasks' &&
      response.status() === 201,
  )
  const updateSynced = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      /^\/api\/v1\/tasks\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.ok(),
  )

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await Promise.all([createSynced, updateSynced])

  await page.reload()
  await expect(page.getByText(taskTitle, { exact: true })).toHaveCount(0)
  await expect(page.getByText(updatedTaskTitle, { exact: true })).toHaveCount(1)
})

test('deletes the current account from profile after email confirmation', async ({
  page,
}) => {
  const user = createE2eUser('e2e-account-deletion')

  await registerUser({ ...user, page })
  await page.goto('/profile')

  await expect(
    page.getByRole('heading', { name: 'Удаление аккаунта' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Удалить аккаунт' }).click()

  const dialog = page.getByRole('alertdialog', {
    name: `Удалить аккаунт ${user.displayName}?`,
  })

  await expect(dialog).toContainText(
    'Аккаунт и все связанные с ним данные будут безвозвратно удалены',
  )
  await expect(
    dialog.getByRole('button', { name: 'Удалить навсегда' }),
  ).toBeDisabled()

  await dialog
    .getByRole('textbox', { name: 'Email для подтверждения удаления' })
    .fill(user.email)
  await dialog.getByRole('button', { name: 'Удалить навсегда' }).click()

  await expect(page.getByRole('tab', { name: 'Вход' })).toBeVisible()

  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Пароль', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page.getByRole('alert')).toContainText(
    'Неверный email или пароль.',
  )
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

test('redirects legacy habits route and manages a self-care item', async ({
  page,
}) => {
  const user = createE2eUser('e2e-self-care')
  const careTitle = `E2E water ${user.suffix}`

  await registerUser({ ...user, page })

  await page.goto(
    `/habits?habitsAction=habit&habitsActionRequest=${user.suffix}`,
  )
  await expect(page).toHaveURL(/\/self-care\?tab=rituals/)

  await page.goto(
    `/self-care?tab=rituals&selfCareAction=care&selfCareActionRequest=custom`,
  )

  const dialog = page.getByRole('dialog', { name: 'Создать свою заботу' })

  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Название').fill(careTitle)
  await dialog.getByRole('button', { name: 'Создать заботу' }).click()

  await expect(
    page.getByRole('heading', { name: careTitle }).last(),
  ).toBeVisible()

  await expect(
    page.getByRole('button', { name: 'Убрать из плана' }),
  ).toBeVisible()

  await page.goto('/self-care?tab=rituals')
  await expect(
    page.getByRole('heading', { name: careTitle }).last(),
  ).toBeVisible()

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe(
      `Удалить «${careTitle}» из заботы о себе? История останется в разделе.`,
    )
    await dialog.accept()
  })
  await page
    .getByRole('button', {
      name: `Удалить заботу «${careTitle}»`,
    })
    .click()
  await expect(page.getByRole('heading', { name: careTitle })).toBeHidden()
})

test('creates self-care offline and keeps it after reconnect and reload', async ({
  context,
  page,
}) => {
  const user = createE2eUser('e2e-self-care-offline')
  const careTitle = `E2E offline care ${user.suffix}`

  await registerUser({ ...user, page })
  await page.goto(
    `/self-care?tab=rituals&selfCareAction=care&selfCareActionRequest=custom`,
  )

  const dialog = page.getByRole('dialog', { name: 'Создать свою заботу' })
  await expect(dialog).toBeVisible()

  await context.setOffline(true)
  await expect(page.getByText('Нет подключения').first()).toBeVisible()
  await dialog.getByLabel('Название').fill(careTitle)
  await dialog.getByRole('button', { name: 'Создать заботу' }).click()

  await expect(
    page.getByRole('heading', { name: careTitle }).last(),
  ).toBeVisible()
  await expect(
    page.getByText('Изменения сохранены на устройстве'),
  ).toBeVisible()

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('Изменения сохранены на устройстве')).toBeHidden({
    timeout: 15_000,
  })

  await page.reload()
  await expect(
    page.getByRole('heading', { name: careTitle }).last(),
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

  await expect(page.getByRole('heading', { name: zoneTitle })).toBeVisible()
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

test('creates a cleaning zone offline and keeps it after reconnect and reload', async ({
  context,
  page,
}) => {
  const user = createE2eUser('e2e-cleaning-offline')
  const zoneTitle = `E2E offline zone ${user.suffix}`

  await registerUser({ ...user, page })
  await page.goto('/cleaning/settings')
  await expect(
    page.getByRole('button', { name: 'Добавить зону' }),
  ).toBeVisible()

  await context.setOffline(true)
  await expect(
    page.getByText('Настройки открыты из сохранённых данных'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Добавить зону' }).click()

  const zoneForm = page.locator('form').filter({
    has: page.getByPlaceholder('Новая зона'),
  })
  await zoneForm.getByPlaceholder('Новая зона').fill(zoneTitle)
  await zoneForm.getByRole('button', { name: 'Добавить' }).click()

  await expect(page.getByRole('heading', { name: zoneTitle })).toBeVisible()
  await expect(
    page.getByText('Изменения сохранены на устройстве'),
  ).toBeVisible()

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('Изменения сохранены на устройстве')).toBeHidden({
    timeout: 15_000,
  })

  await page.reload()
  await expect(page.getByRole('heading', { name: zoneTitle })).toBeVisible()
})
