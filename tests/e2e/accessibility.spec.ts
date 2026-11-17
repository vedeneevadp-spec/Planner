import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.11' } })

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

  await expect(page.getByRole('button', { name: 'Новая задача' })).toBeVisible()
}

async function expectNoBlockingA11yViolations(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    )
  })
  const results = await new AxeBuilder({ page }).analyze()
  const blockingViolations = results.violations.filter((violation) =>
    blockingImpacts.has(violation.impact ?? ''),
  )

  expect(
    blockingViolations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
    `Accessibility violations at ${page.url()} (${JSON.stringify(page.viewportSize())})`,
  ).toEqual([])
}

test('keeps desktop and mobile screens free of blocking accessibility violations', async ({
  page,
}) => {
  await page.goto('/today')
  await expect(page.getByRole('tab', { name: 'Вход' })).toBeVisible()
  await expectNoBlockingA11yViolations(page)

  await registerUser({ ...createE2eUser('e2e-a11y'), page })

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    for (const route of [
      {
        path: '/today',
        ready: () => page.getByRole('region', { name: 'Ресурс дня' }),
      },
      {
        path: '/shopping',
        ready: () => page.getByPlaceholder('Добавить покупку'),
      },
      {
        path: '/calendar',
        ready: () =>
          page.getByRole('heading', { name: 'Календарь', exact: true }),
      },
      {
        path: '/spheres',
        ready: () => page.getByRole('heading', { name: 'Сфер пока нет' }),
      },
      {
        path: '/self-care',
        ready: () => page.getByRole('heading', { name: 'Сегодня спокойно' }),
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
  }
})

test('contains keyboard focus in the task composer and returns it to the opener', async ({
  page,
}) => {
  await registerUser({ ...createE2eUser('e2e-modal-focus'), page })
  const opener = page.getByRole('button', { name: 'Новая задача', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Новая задача' })
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole('textbox', { name: 'Задача', exact: true })
    .fill('Черновик клавиатурной проверки')
  const moveToBoundary = async (last: boolean) =>
    dialog.evaluate((root, useLast) => {
      const controls = [
        ...root.querySelectorAll<HTMLElement>(
          'a[href],button,input,select,textarea,[tabindex]',
        ),
      ].filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.matches(':disabled') &&
          !element.closest('[hidden],[inert]') &&
          element.getClientRects().length > 0,
      )
      const control = useLast ? controls.at(-1) : controls[0]
      if (!control) throw new Error('No focusable control in composer')
      control.setAttribute('data-focus-boundary', useLast ? 'last' : 'first')
      control.focus()
    }, last)
  await moveToBoundary(false)
  await page.keyboard.press('Shift+Tab')
  await moveToBoundary(true)
  await page.keyboard.press('Tab')
  await expect(dialog.locator('[data-focus-boundary="first"]')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.locator('[data-focus-boundary="last"]')).toBeFocused()
  const iconOpener = dialog.getByRole('button', { name: /^Выбрать иконку/ })
  await iconOpener.click()
  const picker = page.getByRole('dialog', { name: 'Иконка', exact: true })
  await expect(picker).toBeVisible()
  await expect(dialog).toHaveAttribute('inert', '')
  await page.keyboard.press('Tab')
  await expect
    .poll(() =>
      picker.evaluate((root) => root.contains(document.activeElement)),
    )
    .toBe(true)
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await expect(iconOpener).toBeFocused()
  await expect(dialog).not.toHaveAttribute('inert')
  await expect
    .poll(() =>
      page.locator('#root').evaluate((root) => root.hasAttribute('inert')),
    )
    .toBe(true)
  await page.screenshot({
    path: 'tmp/audit-fixes-2026-11-15/modal-focus-desktop.png',
  })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
  await page.goto('/profile')
  await expect(
    page.getByRole('region', { name: 'Подтверждение email' }),
  ).toBeVisible()
  await page.screenshot({
    path: 'tmp/audit-fixes-2026-11-15/profile-email-verification.png',
    fullPage: true,
  })
})
