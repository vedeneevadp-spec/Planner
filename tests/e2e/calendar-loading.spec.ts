import AxeBuilder from '@axe-core/playwright'
import { expect, type Locator, test } from '@playwright/test'

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.14' } })

async function sampleWeekGeometry(week: Locator) {
  return week.evaluate(async (surface) => {
    const samples = []
    for (let index = 0; index < 15; index += 1) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      )
      const bounds = surface.getBoundingClientRect()
      samples.push({
        top: bounds.top,
        height: bounds.height,
        scrollTop: surface.scrollTop,
      })
    }
    return samples
  })
}

test('keeps week geometry stable while loading and rapidly switching periods', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/today')
  await page.getByRole('tab', { name: 'Регистрация' }).click()
  await page.getByLabel('Имя').fill('Проверка календаря')
  await page
    .getByLabel('Email')
    .fill(`calendar-loading-${Date.now()}@example.test`)
  await page.getByLabel('Пароль', { exact: true }).fill('e2e-password')
  await page.getByLabel('Подтвердите пароль').fill('e2e-password')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(
    page.getByRole('button', { name: 'Новая задача', exact: true }),
  ).toBeVisible()

  const initialReads = Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/tasks/cursor' &&
        response.ok(),
    ),
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/self-care/plan' &&
        response.ok(),
    ),
  ])
  await page.goto('/calendar?calendarView=week')
  await initialReads
  const week = page.getByRole('region', { name: 'Неделя', exact: true })
  const loading = page.getByRole('status', {
    name: 'Обновляем календарь',
    exact: true,
  })
  await expect(week).toBeVisible()
  await expect(loading).toBeHidden()
  await page.evaluate(async () => {
    await document.fonts.ready
    localStorage.setItem('chaotika.color-theme', 'dark')
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'chaotika.color-theme',
        newValue: 'dark',
      }),
    )
  })

  let networkMode: 'normal' | 'held' | 'error' = 'normal'
  let pendingReads = Promise.resolve()
  const interceptedReads: string[] = []
  await page.route(
    (url) =>
      ['/api/v1/tasks/cursor', '/api/v1/self-care/plan'].includes(url.pathname),
    async (route) => {
      const mode = networkMode
      if (mode === 'held') {
        interceptedReads.push(route.request().url())
        await pendingReads
      }
      if (
        mode === 'error' &&
        new URL(route.request().url()).pathname === '/api/v1/tasks/cursor'
      ) {
        await route.fulfill({
          status: 503,
          json: {
            error: { code: 'internal_error', message: 'Calendar test failure' },
          },
        })
      } else {
        await route.continue()
      }
    },
  )

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    const baseline = (await sampleWeekGeometry(week))[0]!
    let releaseReads = () => {}
    pendingReads = new Promise<void>((resolve) => {
      releaseReads = resolve
    })
    networkMode = 'held'
    const samples = []
    const initialTitle = await page
      .getByTestId('calendar-period-title')
      .textContent()

    // Every destination is new, so both calendar reads remain in flight.
    for (let index = 0; index < 5; index += 1) {
      await page
        .getByRole('button', { name: 'Следующий период', exact: true })
        .click()
      await expect(loading).toBeVisible()
      samples.push(...(await sampleWeekGeometry(week)))
    }
    for (let index = 0; index < 2; index += 1) {
      await page
        .getByRole('button', { name: 'Предыдущий период', exact: true })
        .click()
      samples.push(...(await sampleWeekGeometry(week)))
    }
    await expect(page.getByTestId('calendar-period-title')).not.toHaveText(
      initialTitle!,
    )
    await expect(
      page.getByText('Дополняем календарь', { exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(loading).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath(`loading-dark-${viewport.width}.png`),
      fullPage: true,
      animations: 'disabled',
    })

    networkMode = 'normal'
    releaseReads()
    samples.push(...(await sampleWeekGeometry(week)))
    await expect(loading).toBeHidden()
    samples.push(...(await sampleWeekGeometry(week)))
    expect(
      samples.every((sample) => Math.abs(sample.top - baseline.top) < 0.5),
    ).toBe(true)
    expect(
      samples.every(
        (sample) => Math.abs(sample.height - baseline.height) < 0.5,
      ),
    ).toBe(true)
    expect(
      samples.every(
        (sample) => Math.abs(sample.scrollTop - baseline.scrollTop) < 0.5,
      ),
    ).toBe(true)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await testInfo.attach(`geometry-${viewport.width}`, {
      body: JSON.stringify({ baseline, samples }),
      contentType: 'application/json',
    })
    await page.screenshot({
      path: testInfo.outputPath(`loaded-dark-${viewport.width}.png`),
      fullPage: true,
      animations: 'disabled',
    })
  }

  expect(
    interceptedReads.some(
      (url) => new URL(url).pathname === '/api/v1/tasks/cursor',
    ),
  ).toBe(true)
  expect(
    interceptedReads.some(
      (url) => new URL(url).pathname === '/api/v1/self-care/plan',
    ),
  ).toBe(true)
  networkMode = 'error'
  // Move beyond the furthest visited week to exercise a real failed request.
  for (let index = 0; index < 3; index += 1) {
    await page
      .getByRole('button', { name: 'Следующий период', exact: true })
      .click()
  }
  await expect(page.getByRole('alert')).toContainText(
    'Календарь обновился не полностью',
    { timeout: 15_000 },
  )
  await expect(week).toBeVisible()
  networkMode = 'normal'
  await page.getByRole('button', { name: 'Обновить', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(loading).toBeHidden()
  await expect(week).toBeVisible()
  const accessibility = await new AxeBuilder({ page })
    .include('[data-calendar-view]')
    .analyze()
  expect(
    accessibility.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([])
  expect(errors).toEqual([])
})
