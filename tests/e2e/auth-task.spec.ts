import { expect, test } from '@playwright/test'

test('registers a user and creates a task through the app shell', async ({
  page,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = `e2e-${suffix}@example.test`
  const password = 'e2e-password'
  const taskTitle = `E2E task ${suffix}`
  const updatedTaskTitle = `${taskTitle} updated`

  await page.goto('/today')
  await page.getByRole('tab', { name: 'Регистрация' }).click()
  await page.getByLabel('Имя').fill('E2E User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByLabel('Подтвердите пароль').fill(password)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page.getByRole('button', { name: 'Новая задача' })).toBeVisible()

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
