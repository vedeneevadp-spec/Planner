import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

test('offers an optional Android update, manual check and install retry in the real app', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    let listener: ((state: unknown) => void) | undefined
    let state = {
      installedVersion: '1.1.27',
      installedBuild: 35,
      update: {
        versionCode: 36,
        versionName: '1.1.28',
        sizeBytes: 6000000,
        notes: 'Обновления теперь можно устанавливать прямо из Хаотики.',
      },
      downloaded: false,
      downloading: false,
      progress: 0,
      dismissed: false,
    }
    const calls: string[] = []
    Object.assign(window, {
      __appUpdatesTest: {
        calls,
        progress(value: number) {
          state = { ...state, downloading: true, progress: value }
          listener?.(state)
        },
      },
      CapacitorCustomPlatform: { name: 'android' },
      Capacitor: {
        nativeCallback(
          plugin: string,
          _method: string,
          _options: unknown,
          callback: (state: unknown) => void,
        ) {
          if (plugin === 'PlannerAppUpdates') listener = callback
          return 'test-listener'
        },
        nativePromise(
          plugin: string,
          method: string,
          options: Record<string, string | boolean> = {},
        ) {
          if (plugin === 'PlannerAppUpdates') {
            calls.push(method)
            if (method === 'dismiss') state = { ...state, dismissed: true }
            if (method === 'download')
              state = {
                ...state,
                downloaded: true,
                downloading: false,
                progress: 100,
              }
            if (method === 'install')
              return Promise.reject(
                Object.assign(new Error('Permission denied'), {
                  code: 'INSTALL_PERMISSION',
                }),
              )
            return Promise.resolve(state)
          }
          if (plugin === 'PlannerAuthStorage') {
            const key = String(options.key)
            if (method === 'get')
              return Promise.resolve({ value: localStorage.getItem(key) })
            if (method === 'set')
              localStorage.setItem(key, String(options.value))
            if (method === 'remove') localStorage.removeItem(key)
          }
          return Promise.resolve({})
        },
        PluginHeaders: [
          {
            name: 'PlannerAppUpdates',
            methods: [
              'getState',
              'check',
              'download',
              'install',
              'dismiss',
              'removeListener',
            ]
              .map((name) => ({ name, rtype: 'promise' }))
              .concat([{ name: 'addListener', rtype: 'callback' }]),
          },
          {
            name: 'PlannerAuthStorage',
            methods: [
              'get',
              'set',
              'remove',
              'prepareRefresh',
              'commitRefresh',
            ].map((name) => ({ name, rtype: 'promise' })),
          },
        ],
      },
    })
  })
  await page.goto('/today')
  const banner = page.getByRole('region', { name: 'Обновление Хаотики' })
  await expect(
    banner.getByRole('button', { name: 'Обновить', exact: true }),
  ).toBeEnabled()
  await banner.getByRole('button', { name: 'Позже' }).click()
  await expect(banner).toBeHidden()

  await page
    .getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' })
    .click()
  await page.getByLabel('Имя').fill('Обновление')
  await page.getByLabel('Email').fill(`update-${Date.now()}@example.test`)
  await page.getByLabel('Пароль', { exact: true }).fill('e2e-password')
  await page.getByLabel('Подтвердите пароль').fill('e2e-password')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('button', { name: 'Новая задача' })).toBeVisible()
  await page.getByRole('link', { name: 'Ещё', exact: true }).click()
  const manual = page.getByRole('button', { name: /Проверить обновление/ })
  await expect(manual).toContainText('1.1.27')
  await manual.click()
  await expect(banner).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Ещё', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('update-light.png') })
  const a11y = await new AxeBuilder({ page })
    .include('[aria-label="Обновление Хаотики"]')
    .analyze()
  expect(
    a11y.violations.filter((item) =>
      ['serious', 'critical'].includes(item.impact ?? ''),
    ),
  ).toEqual([])
  await page.getByRole('button', { name: /Темная тема/ }).click()
  await page.screenshot({ path: testInfo.outputPath('update-dark.png') })
  const darkA11y = await new AxeBuilder({ page })
    .include('[aria-label="Обновление Хаотики"]')
    .analyze()
  expect(
    darkA11y.violations.filter((item) =>
      ['serious', 'critical'].includes(item.impact ?? ''),
    ),
  ).toEqual([])

  await banner.getByRole('button', { name: 'Обновить', exact: true }).click()
  await expect(banner.getByRole('status')).toContainText(
    'разрешите установку из Хаотики',
  )
  await banner.getByRole('button', { name: 'Установить', exact: true }).click()
  const calls = await page.evaluate(
    () =>
      (window as unknown as { __appUpdatesTest: { calls: string[] } })
        .__appUpdatesTest.calls,
  )
  expect(calls.filter((method) => method === 'download')).toHaveLength(1)
  expect(calls.filter((method) => method === 'install')).toHaveLength(2)
  await banner.getByRole('button', { name: 'Позже' }).click()
  await expect(banner).toBeHidden()
})
