import { addDateDays, getTodayDate } from '@planner/contracts'
import { expect, test } from '@playwright/test'

test.use({
  extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.11' },
  timezoneId: 'UTC',
})

for (const viewport of [
  { name: 'desktop', width: 1360, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`creates flexible and dated tasks with all settings on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/today')
    await page.getByRole('tab', { name: 'Регистрация' }).click()
    await page.getByLabel('Имя').fill('Гибкие задачи')
    await page
      .getByLabel('Email')
      .fill(`flexible-${viewport.name}-${Date.now()}@example.test`)
    await page.getByLabel('Пароль', { exact: true }).fill('e2e-password')
    await page.getByLabel('Подтвердите пароль').fill('e2e-password')
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(
      page.getByRole('button', { name: 'Новая задача', exact: true }),
    ).toBeVisible()
    await page.setViewportSize(viewport)

    const composer = page.getByRole('dialog', { name: 'Новая задача' })
    const openComposer = async () => {
      await page
        .getByRole('button', { name: 'Новая задача', exact: true })
        .or(page.getByRole('button', { name: 'Создать задачу', exact: true }))
        .first()
        .click()
      await expect(composer).toBeVisible()
    }
    const saveTask = async () => {
      const created = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/v1/tasks' &&
          response.status() === 201,
      )
      await composer
        .getByRole('button', { name: 'Добавить задачу' })
        .last()
        .click()
      const response = await created
      await expect(composer).toBeHidden()
      const input = response.request().postDataJSON() as {
        plannedDate: string | null
        plannedStartTime: string | null
        reminderOffsets?: number[]
      }
      expect(input.reminderOffsets ?? []).toEqual(
        input.plannedDate && input.plannedStartTime ? [15] : [],
      )
      return response.json() as Promise<{
        importance: string
        necessity: string
        note: string
        plannedDate: string | null
        plannedStartTime: string | null
        plannedEndTime: string | null
        resource: number
      }>
    }

    await openComposer()
    await expect(composer.getByLabel('План')).toBeHidden()
    await expect(composer.getByLabel('Старт')).toBeHidden()
    await composer
      .getByRole('textbox', { name: 'Задача' })
      .fill('Разобрать документы')
    await composer
      .getByRole('textbox', { name: 'Заметка' })
      .fill('Паспорта и страховки')
    await composer.getByRole('button', { name: 'Пометить как важное' }).click()
    await composer.getByRole('button', { name: 'По возможности' }).click()
    await composer.getByRole('button', { name: 'Расход 2' }).click()
    await composer.locator('form').screenshot({
      path: testInfo.outputPath(`flexible-create-${viewport.name}.png`),
    })
    const flexible = await saveTask()
    expect(flexible).toMatchObject({
      plannedDate: null,
      plannedStartTime: null,
      plannedEndTime: null,
      importance: 'important',
      necessity: 'optional',
      resource: -2,
      note: 'Паспорта и страховки',
    })
    await expect(
      page.getByRole('button', { name: 'Актуальное' }),
    ).toHaveAttribute('aria-expanded', 'true')
    await expect(
      page.getByText('Разобрать документы', { exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByText('Разобрать документы', { exact: true }),
    ).toBeVisible()

    await openComposer()
    await expect(composer.getByLabel('План')).toBeHidden()
    await composer
      .getByRole('textbox', { name: 'Задача' })
      .fill('Отнести документы')
    await composer.getByRole('button', { name: 'Указать дату' }).click()
    const tomorrow = addDateDays(getTodayDate('UTC'), 1)
    await composer.getByLabel('План').fill(tomorrow)
    await composer.getByLabel('Старт').fill('18:00')
    const finish = composer.getByLabel('Финиш').filter({ visible: true })
    await finish.fill('18:30')
    await expect(composer.getByText('Напомнить', { exact: true })).toBeVisible()
    await composer.locator('form').screenshot({
      path: testInfo.outputPath(`dated-create-${viewport.name}.png`),
    })
    const dated = await saveTask()
    expect(dated).toMatchObject({
      plannedDate: tomorrow,
      plannedStartTime: '18:00',
      plannedEndTime: '18:30',
    })

    await openComposer()
    await composer
      .getByRole('textbox', { name: 'Задача' })
      .fill('Когда будет удобно')
    await composer
      .getByRole('textbox', { name: 'Заметка' })
      .fill('Сохранить контекст')
    await composer.getByLabel('Повторять задачу').check()
    await expect(composer.getByLabel('План')).toBeHidden()
    await composer.getByRole('button', { name: 'Указать дату' }).click()
    await composer.getByLabel('План').fill(tomorrow)
    await composer.getByLabel('Старт').fill('10:00')
    await composer.getByRole('button', { name: 'Оставить без даты' }).click()
    await expect(composer.getByLabel('План')).toBeHidden()
    await expect(composer.getByText('Напомнить', { exact: true })).toBeHidden()
    expect(await saveTask()).toMatchObject({
      plannedDate: null,
      plannedStartTime: null,
      plannedEndTime: null,
      note: 'Сохранить контекст',
      recurrence: { isActive: true },
    })

    const task = page.locator('article').filter({
      has: page.getByText('Разобрать документы', { exact: true }),
    })
    await task.getByRole('button', { name: /^Завершить( задачу)?$/ }).click()
    await expect(task).toBeHidden()
    await page.reload()
    await expect(
      page.getByText('Когда будет удобно', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Разобрать документы', { exact: true }),
    ).toBeHidden()
    expect(errors).toEqual([])
    await page.screenshot({
      path: testInfo.outputPath(`flexible-today-${viewport.name}.png`),
      fullPage: true,
    })
  })
}
