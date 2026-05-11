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

test('keeps auth after reload and exposes password reset after failed sign-in', async ({
  page,
}) => {
  const user = createE2eUser('e2e-auth')

  await registerUser({ ...user, page })

  await page.reload()
  await expect(page.getByRole('button', { name: 'Новая задача' })).toBeVisible()

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

  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.getByLabel('Название').fill(workspaceName)
  await page.getByRole('button', { name: 'Создать', exact: true }).click()

  await expect(page.getByRole('heading', { name: workspaceName })).toBeVisible()
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
