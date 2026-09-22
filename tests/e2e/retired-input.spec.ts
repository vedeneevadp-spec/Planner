import { randomUUID } from 'node:crypto'

import { expect, type Page, test } from '@playwright/test'
import { Client } from 'pg'

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.13' } })

async function registerTestAdmin(page: Page) {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'An explicit isolated DATABASE_URL is required for this E2E fixture.',
    )
  }

  const email = `e2e-retired-input-${randomUUID()}@example.test`
  await page.goto('/today')
  await page
    .getByRole('tab', { name: 'Регистрация' })
    .or(page.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }))
    .click()
  await page.getByLabel('Имя').fill('Retired input E2E')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill('e2e-password')
  await page.getByLabel('Подтвердите пароль').fill('e2e-password')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(
    page.getByRole('button', { name: /^(Создать задачу|Новая задача)$/ }),
  ).toBeVisible()

  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    // Only this test's newly registered account is changed; no seeded or real user.
    const result = await client.query(
      `update app.users
       set app_role = case when app_role = 'owner' then app_role else 'admin'::app.app_role end
       where email = $1`,
      [email],
    )
    expect(result.rowCount).toBe(1)
  } finally {
    await client.end()
  }
  // The API caches a session snapshot for 30 seconds. A fresh sign-in gives the
  // promoted fixture a new session without waiting or changing runtime caches.
  await page.goto('/more')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(
    page.getByRole('button', { name: 'Войти', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(
    page.getByRole('link', { name: 'Admin', exact: true }),
  ).toBeVisible()
  await page.goto('/today')
  await expect(
    page.getByRole('button', { name: /^(Создать задачу|Новая задача)$/ }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('button', { name: /^(Создать задачу|Новая задача)$/ }),
  ).toBeVisible()
}

const viewports = [
  { height: 900, name: 'wide', width: 1365 },
  { height: 844, name: 'narrow', width: 390 },
]

for (const viewport of viewports) {
  test(`keeps retired input absent and ordinary routes usable on ${viewport.name} screens`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    const voiceRequests: string[] = []
    const renderErrors: string[] = []
    let microphoneAttempts = 0

    page.on('request', (request) => {
      if (
        /^\/api\/(?:v1\/)?voice(?:\/|$)/.test(new URL(request.url()).pathname)
      ) {
        voiceRequests.push(request.url())
      }
    })
    page.on('pageerror', (error) => renderErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') renderErrors.push(message.text())
    })
    await page.exposeFunction('__retiredInputMicrophoneAttempt', () => {
      microphoneAttempts += 1
    })
    await page.addInitScript(() => {
      const reportAttempt = Reflect.get(
        window,
        '__retiredInputMicrophoneAttempt',
      ) as () => Promise<void>
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: async () => {
          await reportAttempt()
          throw new DOMException(
            'Unexpected microphone request',
            'NotAllowedError',
          )
        },
      })
      if (!sessionStorage.getItem('e2e.retiredInput.seeded')) {
        localStorage.setItem(
          'planner.voiceAssistant.deviceSettings.v1',
          JSON.stringify({
            wakeWordEnabled: true,
            backgroundWakeWordEnabled: true,
          }),
        )
        sessionStorage.setItem('planner.webVoice.sessionId.v1', 'old-session')
        localStorage.setItem('e2e.retiredInput.preserved', 'keep')
        sessionStorage.setItem('e2e.retiredInput.seeded', 'true')
      }
    })

    await registerTestAdmin(page)

    for (const route of [
      { path: '/more', screenshot: 'more' },
      { path: '/notifications/settings', screenshot: 'notifications' },
      { path: '/admin', screenshot: 'admin-settings' },
      { path: '/voice-assistant/settings', screenshot: 'retired-route' },
      { path: '/today', screenshot: 'today' },
      { path: '/calendar', screenshot: 'calendar' },
      { path: '/shopping', screenshot: 'shopping' },
    ]) {
      await test.step(route.path, async () => {
        await page.goto(route.path)
        if (route.path === '/more') {
          await expect(
            page.getByRole('button', { name: 'Выйти' }),
          ).toBeVisible()
          const settings = page.getByRole('region', {
            name: 'Настройки',
            exact: true,
          })
          await expect(
            settings.getByRole('link', { name: 'Уведомления' }),
          ).toBeVisible()
          await settings.getByRole('link', { name: 'Уведомления' }).focus()
          await expect(
            settings.getByRole('link', { name: 'Уведомления' }),
          ).toBeFocused()
        } else if (route.path === '/notifications/settings') {
          await expect(
            page.getByRole('heading', { name: 'Уведомления', exact: true }),
          ).toBeVisible()
          await expect(
            page.getByRole('heading', { name: 'Доставка на Android' }),
          ).toBeVisible()
        } else if (route.path === '/admin') {
          await page
            .getByRole('tab', { name: 'Настройки', exact: true })
            .click()
          await expect(
            page.getByRole('heading', { name: 'Поведение приложения' }),
          ).toBeVisible()
          await expect(
            page.getByRole('checkbox', {
              name: /Конфетти при завершении задачи/,
            }),
          ).toBeVisible()
        } else if (route.path === '/shopping') {
          await expect(page.getByPlaceholder('Добавить покупку')).toBeVisible()
        } else if (route.path === '/calendar') {
          await expect(
            page.getByRole('button', { name: 'Предыдущий период' }),
          ).toBeVisible()
          await expect(page.getByTestId('calendar-period-title')).toHaveText(
            /\S/,
          )
          await expect(
            page.getByRole('region', {
              name: /^(День|Неделя|Месяц|Расписание)$/,
            }),
          ).toBeVisible()
        } else {
          await expect(
            page.getByRole('button', {
              name: /^(Создать задачу|Новая задача)$/,
            }),
          ).toBeVisible()
          await expect(
            page.getByRole('region', { name: 'Антиперегруз' }),
          ).toBeVisible()
        }
        await expect(page.getByTestId('page-state-skeleton')).toHaveCount(0)
        await expect(page).toHaveURL(
          new RegExp(
            `${route.path === '/voice-assistant/settings' ? '/today' : route.path}(?:\\?.*)?$`,
          ),
        )
        const retiredLabel = /голосовой|микрофон|wake.?word|запись аудио/i
        await expect(
          page.getByRole('button', { name: retiredLabel }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('link', { name: retiredLabel }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('checkbox', { name: retiredLabel }),
        ).toHaveCount(0)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(viewport.width)

        const screenshot = testInfo.outputPath(
          `${route.screenshot}-${viewport.name}.png`,
        )
        await page.screenshot({
          animations: 'disabled',
          fullPage: true,
          path: screenshot,
        })
        await testInfo.attach(route.screenshot, {
          contentType: 'image/png',
          path: screenshot,
        })
      })
    }

    // Observe longer than the removed pending-command polling interval (1.5 s).
    await page.waitForTimeout(1700)
    expect(voiceRequests).toEqual([])
    expect(microphoneAttempts).toBe(0)
    expect(renderErrors).toEqual([])
    expect(
      await page.evaluate(() => ({
        deviceSettings: localStorage.getItem(
          'planner.voiceAssistant.deviceSettings.v1',
        ),
        preserved: localStorage.getItem('e2e.retiredInput.preserved'),
        voiceSession: sessionStorage.getItem('planner.webVoice.sessionId.v1'),
      })),
    ).toEqual({ deviceSettings: null, preserved: 'keep', voiceSession: null })
  })
}
