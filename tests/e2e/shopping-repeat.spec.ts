import { expect, test } from '@playwright/test'

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.12' } })

test('keeps the chosen category when buying the same item again on mobile', async ({
  page,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const title = `Молоко ${suffix}`
  await page.goto('/today')
  await page.getByRole('tab', { name: 'Регистрация' }).click()
  await page.getByLabel('Имя').fill('Повторная покупка')
  await page
    .getByLabel('Email')
    .fill(`e2e-shopping-repeat-${suffix}@example.test`)
  await page.getByLabel('Пароль', { exact: true }).fill('e2e-password')
  await page.getByLabel('Подтвердите пароль').fill('e2e-password')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(
    page.getByRole('button', { name: 'Создать задачу' }),
  ).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/shopping')
  await page.getByPlaceholder('Добавить покупку').fill(title)
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/chaos-inbox' &&
      response.ok(),
  )
  await page.getByRole('button', { name: 'Добавить покупку' }).click()
  await created
  const active = page.getByRole('region', { name: 'Актуальные покупки' })
  await expect(active.getByText(title, { exact: true })).toBeVisible()
  await expect(active.getByLabel('Тип: Прочее')).toBeVisible()

  const completed = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname.startsWith('/api/v1/chaos-inbox/') &&
      response.ok(),
  )
  await active.getByText(title, { exact: true }).click()
  await completed
  await page.reload()
  await expect(
    page.getByRole('region', { name: 'Купленные покупки' }).getByText(title),
  ).toBeVisible()

  await page.getByPlaceholder('Добавить покупку').fill(title)
  await page.getByRole('button', { name: 'Выбрать вид: Продукты' }).click()
  const reactivated = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname.startsWith('/api/v1/chaos-inbox/') &&
      response.ok(),
  )
  await page.getByRole('button', { name: 'Добавить покупку' }).click()
  const response = await reactivated
  expect(await response.json()).toMatchObject({
    shoppingCategory: 'groceries',
    status: 'new',
  })
  await page.getByRole('button', { name: 'Продукты', exact: true }).click()
  await page.reload()
  await expect(active.getByText(title, { exact: true })).toBeVisible()
  await expect(active.getByLabel('Тип: Продукты')).toBeVisible()
  await expect(active.getByText(title, { exact: true })).toHaveCount(1)
})
