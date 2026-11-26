import { randomUUID } from 'node:crypto'

import { addDateDays, getTodayDate } from '@planner/contracts'
import { expect, type Locator, test } from '@playwright/test'

test.use({
  timezoneId: 'UTC',
})

const viewports = [
  { name: 'desktop', width: 1360, height: 900, clientAddress: 16 },
  { name: 'mobile', width: 390, height: 844, clientAddress: 17 },
]

for (const viewport of viewports) {
  test.describe(() => registerTaskScenario(viewport))
}

function registerTaskScenario(viewport: (typeof viewports)[number]) {
  const touch = viewport.name === 'mobile'
  test.use({ hasTouch: touch, colorScheme: touch ? 'dark' : 'light' })
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
    const clock = page.getByRole('dialog', { name: /^Выбор времени/ })
    const press = (control: Locator) =>
      touch ? control.tap() : control.click()
    const setOnDial = async (field: Locator, hour: string, minute: string) => {
      await press(field)
      await press(
        clock
          .getByRole('slider', { name: 'Часы на циферблате' })
          .getByText(hour, { exact: true }),
      )
      await press(
        clock
          .getByRole('slider', { name: 'Минуты на циферблате' })
          .getByText(minute, { exact: true }),
      )
      await press(clock.getByRole('button', { name: 'Установить' }))
    }
    const setWithKeyboard = async (
      field: Locator,
      hour: string,
      minute: string,
    ) => {
      await field.click()
      await clock.getByRole('button', { name: 'Ввести с клавиатуры' }).click()
      await clock.getByRole('textbox', { name: 'Часы' }).fill(hour)
      await clock.getByRole('textbox', { name: 'Минуты' }).fill(minute)
      await clock.getByRole('button', { name: 'Установить' }).click()
    }
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
    await composer.getByRole('button', { name: 'Сегодня', exact: true }).click()
    const today = getTodayDate('UTC')
    await expect(composer.getByLabel('План')).toHaveValue(today)
    await composer.getByRole('button', { name: 'Завтра', exact: true }).click()
    const tomorrow = addDateDays(today, 1)
    await expect(composer.getByLabel('План')).toHaveValue(tomorrow)
    await setOnDial(composer.getByLabel('Старт'), '18', '00')
    const finish = composer.getByLabel('Финиш').filter({ visible: true })
    await setWithKeyboard(finish, '18', '39')
    await expect(composer.getByText('Напомнить', { exact: true })).toBeVisible()
    await composer.locator('form').screenshot({
      path: testInfo.outputPath(`dated-create-${viewport.name}.png`),
    })
    const dated = await saveTask()
    expect(dated).toMatchObject({
      plannedDate: tomorrow,
      plannedStartTime: '18:00',
      plannedEndTime: '18:39',
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
    await setOnDial(composer.getByLabel('Старт'), '00', '15')
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
    await setOnDial(editor.getByLabel('Старт'), '10', '40')
    await setWithKeyboard(
      editor.getByLabel('Финиш').filter({ visible: true }),
      '13',
      '39',
    )
    expect(await saveEdit()).toMatchObject({
      plannedDate: getTodayDate('UTC'),
      plannedStartTime: '10:40',
      plannedEndTime: '13:39',
      reminderOffsets: [15],
      recurrence: { isActive: true },
    })

    await openEditor()
    await editor.getByLabel('Старт').click()
    await expect(
      clock.getByRole('button', { name: 'Часы, 10' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({
      path: testInfo.outputPath(`time-picker-${viewport.name}.png`),
    })
    await clock.getByRole('button', { name: 'Минуты, 40' }).click()
    const minuteDial = clock.getByRole('slider', {
      name: 'Минуты на циферблате',
    })
    const bounds = await minuteDial.boundingBox()
    if (!bounds) throw new Error('Циферблат минут скрыт')
    // Drag from twelve o’clock to the minute between the 35 and 40 labels.
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    const radius = bounds.width * 0.4
    const angle = (39 / 60) * 2 * Math.PI
    await page.mouse.move(x, y - radius)
    await page.mouse.down()
    await page.mouse.move(
      x + Math.sin(angle) * radius,
      y - Math.cos(angle) * radius,
      { steps: 6 },
    )
    await page.mouse.up()
    await expect(minuteDial).toHaveAttribute('aria-valuenow', '39')
    await page.keyboard.press('Escape')
    await expect(clock).toBeHidden()
    await expect(editor.getByLabel('Старт')).toBeFocused()
    await expect(editor.getByLabel('Старт')).toHaveText('10:40')
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
