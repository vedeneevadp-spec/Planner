import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.14' } })

test('pauses recurring care, resumes it from All care and syncs an offline pause', async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/today')
  await page.getByRole('tab', { name: 'Регистрация' }).click()
  await page.getByLabel('Имя').fill('Проверка паузы')
  await page.getByLabel('Email').fill(`care-pause-${Date.now()}@example.test`)
  await page.getByLabel('Пароль', { exact: true }).fill('e2e-password')
  await page.getByLabel('Подтвердите пароль').fill('e2e-password')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(
    page.getByRole('button', { name: 'Новая задача', exact: true }),
  ).toBeVisible()

  const read = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/self-care' && response.ok(),
  )
  await page.goto('/self-care')
  const response = await read
  const observed = await response.request().allHeaders()
  const headers = Object.fromEntries(
    [
      'authorization',
      'x-workspace-id',
      'x-actor-user-id',
      'x-client-timezone',
      'x-forwarded-for',
    ].flatMap((key) => (observed[key] ? [[key, observed[key]]] : [])),
  )
  const apiUrl = response.url().split('?')[0]!
  const created = await page.request.post(apiUrl, {
    headers,
    data: {
      title: 'Йога',
      type: 'habit',
      category: 'movement',
      icon: '🧘',
      preferredTimeOfDay: 'morning',
      scheduleRule: { repeatKind: 'daily', generateInCalendar: true },
    },
  })
  expect(created.ok()).toBe(true)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Йога', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Поставить на паузу: «Йога»', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Йога', exact: true }),
  ).toBeHidden()
  await page
    .getByRole('navigation', { name: 'Разделы заботы о себе' })
    .getByRole('button', { name: 'План', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Йога', exact: true }),
  ).toHaveCount(0)
  await page
    .getByRole('navigation', { name: 'Разделы заботы о себе' })
    .getByRole('button', { name: 'Все заботы', exact: true })
    .click()
  await expect(page.getByText('На паузе', { exact: true })).toBeVisible()

  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      localStorage.setItem('chaotika.color-theme', value)
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'chaotika.color-theme',
          newValue: value,
        }),
      )
    }, theme)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.evaluate(async () => {
        await document.fonts.ready
        await Promise.all(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect?.getTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished.catch(() => undefined)),
        )
      })
      const accessibility = await new AxeBuilder({ page })
        .include('article')
        .analyze()
      expect(
        accessibility.violations.filter((violation) =>
          ['serious', 'critical'].includes(violation.impact ?? ''),
        ),
      ).toEqual([])
      await page.screenshot({
        path: testInfo.outputPath(`paused-${theme}-${viewport.width}.png`),
        fullPage: true,
        animations: 'disabled',
      })
    }
  }

  await page
    .getByRole('button', { name: 'Возобновить: «Йога»', exact: true })
    .click()
  await expect(page.getByText('На паузе', { exact: true })).toHaveCount(0)
  await page
    .getByRole('navigation', { name: 'Разделы заботы о себе' })
    .getByRole('button', { name: 'Сегодня', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Йога', exact: true }),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('resumed-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await context.setOffline(true)
  await page
    .getByRole('button', { name: 'Поставить на паузу: «Йога»', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Йога', exact: true }),
  ).toBeHidden()
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
    page.getByRole('heading', { name: 'Йога', exact: true }),
  ).toBeHidden()
  await page
    .getByRole('navigation', { name: 'Разделы заботы о себе' })
    .getByRole('button', { name: 'Все заботы', exact: true })
    .click()
  await expect(page.getByText('На паузе', { exact: true })).toBeVisible()
  await context.setOffline(true)
  await page
    .getByRole('button', { name: 'Возобновить: «Йога»', exact: true })
    .click()
  await expect(page.getByText('На паузе', { exact: true })).toHaveCount(0)
  await page
    .getByRole('navigation', { name: 'Разделы заботы о себе' })
    .getByRole('button', { name: 'Сегодня', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Йога', exact: true }),
  ).toBeVisible()
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('Изменения сохранены на устройстве')).toBeHidden({
    timeout: 15_000,
  })
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Йога', exact: true }),
  ).toBeVisible()
  expect(errors).toEqual([])
})
