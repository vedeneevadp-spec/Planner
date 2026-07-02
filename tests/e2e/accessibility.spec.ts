import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

const blockingImpacts = new Set(['critical', 'serious'])

function createE2eUser(prefix: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return {
    displayName: `${prefix} User`,
    email: `${prefix}-${suffix}@example.test`,
    password: 'e2e-password',
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

async function expectNoBlockingA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  const blockingViolations = results.violations.filter((violation) =>
    blockingImpacts.has(violation.impact ?? ''),
  )

  expect(
    blockingViolations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([])
}

test('keeps core unauthenticated and authenticated screens free of blocking accessibility violations', async ({
  page,
}) => {
  await page.goto('/today')
  await expect(page.getByRole('tab', { name: 'Вход' })).toBeVisible()
  await expectNoBlockingA11yViolations(page)

  await registerUser({ ...createE2eUser('e2e-a11y'), page })

  for (const route of [
    {
      path: '/today',
      ready: () => page.getByRole('button', { name: 'Создать задачу' }),
    },
    {
      path: '/shopping',
      ready: () => page.getByPlaceholder('Добавить покупку'),
    },
    {
      path: '/calendar',
      ready: () => page.getByRole('button', { name: 'Создать задачу' }),
    },
    {
      path: '/more',
      ready: () => page.getByRole('button', { name: 'Выйти' }),
    },
  ]) {
    await page.goto(route.path)
    await expect(route.ready()).toBeVisible()
    await expectNoBlockingA11yViolations(page)
  }
})
