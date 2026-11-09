import { randomUUID } from 'node:crypto'

import { addDateDays, getTodayDate } from '@planner/contracts'
import { expect, test } from '@playwright/test'

test.use({
  timezoneId: 'UTC',
})

for (const viewport of [
  { name: 'desktop', width: 1360, height: 900, clientAddress: 16 },
  { name: 'mobile', width: 390, height: 844, clientAddress: 17 },
]) {
  test(`creates and edits flexible and dated tasks with all settings on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    // Keep viewports and repeated runs in separate rate-limit buckets.
    await page.setExtraHTTPHeaders({
      'x-forwarded-for': `192.0.2.${viewport.clientAddress + testInfo.repeatEachIndex * 2}`,
    })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/today')
    await page.getByRole('tab', { name: 'Регистрация' }).click()
    await page.getByLabel('Имя').fill('Гибкие задачи')
    await page
      .getByLabel('Email')
      .fill(`flexible-${viewport.name}-${randomUUID()}@example.test`)
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
          new URL(response.url()).pathname === '/api/v1/tasks',
      )
      await composer
        .getByRole('button', { name: 'Добавить задачу' })
        .last()
        .click()
      const response = await created
      expect(response.status(), await response.text()).toBe(201)
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

    const editor = page.getByRole('dialog', { name: 'Редактировать задачу' })
    const openEditor = async () => {
      await page
        .getByRole('button', { name: 'Действия с задачей Когда будет удобно' })
        .click()
      await page
        .getByRole('menuitem', { name: 'Редактировать', exact: true })
        .click()
      await expect(editor).toBeVisible()
    }
    const saveEdit = async () => {
      const updated = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          /^\/api\/v1\/tasks\/[^/]+$/.test(new URL(response.url()).pathname),
      )
      await editor
        .getByRole('button', { name: 'Сохранить', exact: true })
        .filter({ visible: true })
        .first()
        .click()
      const response = await updated
      expect(response.status(), await response.text()).toBe(200)
      await expect(editor).toBeHidden()
      const input = response.request().postDataJSON() as {
        plannedDate: string | null
        plannedStartTime: string | null
        remindBeforeStart?: boolean
        reminderOffsets?: number[]
      }
      expect(input.reminderOffsets ?? []).toEqual(
        input.plannedDate && input.plannedStartTime ? [15] : [],
      )
      expect(input.remindBeforeStart ?? false).toBe(
        Boolean(input.plannedDate && input.plannedStartTime),
      )
      return response.json() as Promise<Record<string, unknown>>
    }

    await openEditor()
    await expect(editor.getByLabel('План')).toBeHidden()
    await editor.getByRole('button', { name: 'Указать дату' }).click()
    await editor.getByLabel('План').fill(getTodayDate('UTC'))
    await editor.getByLabel('Старт').fill('18:00')
    await editor.getByLabel('Финиш').filter({ visible: true }).fill('18:30')
    expect(await saveEdit()).toMatchObject({
      plannedDate: getTodayDate('UTC'),
      plannedStartTime: '18:00',
      plannedEndTime: '18:30',
      reminderOffsets: [15],
      recurrence: { isActive: true },
    })

    await openEditor()
    await editor.locator('form').screenshot({
      path: testInfo.outputPath(`dated-edit-${viewport.name}.png`),
    })
    await editor.getByRole('button', { name: 'Оставить без даты' }).click()
    await expect(editor.getByLabel('План')).toBeHidden()
    await expect(editor.getByText('Напомнить', { exact: true })).toBeHidden()
    await editor.locator('form').screenshot({
      path: testInfo.outputPath(`flexible-edit-${viewport.name}.png`),
    })
    const unscheduled = await saveEdit()
    expect(unscheduled).toMatchObject({
      dueDate: null,
      plannedDate: null,
      plannedStartTime: null,
      plannedEndTime: null,
      note: 'Сохранить контекст',
      recurrence: { isActive: true },
    })
    expect(unscheduled.remindBeforeStart ?? false).toBe(false)
    expect(unscheduled.reminderOffsets ?? []).toEqual([])
    await page.reload()
    await openEditor()
    await expect(editor.getByLabel('План')).toBeHidden()
    await expect(editor.getByLabel('Повторять задачу')).toBeChecked()
    expect(await saveEdit()).toMatchObject({ plannedDate: null })

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
