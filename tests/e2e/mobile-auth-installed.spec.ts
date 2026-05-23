import { expect, type Page, test } from '@playwright/test'

interface MobileInstalledSmokeRuntime {
  expireNativeAuthSession: () => void
  readNativeAuthSession: () => MobileInstalledAuthSession | null
  setActive: (active: boolean) => void
}

interface MobileInstalledAuthSession {
  accessToken: string
  email: string
  expiresAt: string
  refreshToken?: string
  userId: string
}

declare global {
  interface Window {
    __CHAOTIKA_DIAGNOSTICS__?: {
      events: Array<{
        name: string
      }>
    }
    __chaotikaMobileInstalledSmoke?: MobileInstalledSmokeRuntime
    Capacitor?: {
      getPlatform?: () => string
      isNativePlatform?: () => boolean
      nativeCallback?: (
        pluginName: string,
        methodName: string,
        options: unknown,
        callback: (value: unknown) => void,
      ) => Promise<string>
      nativePromise?: (
        pluginName: string,
        methodName: string,
        options: unknown,
      ) => Promise<unknown>
      PluginHeaders?: Array<{
        methods: Array<{
          name: string
          rtype: 'callback' | 'promise'
        }>
        name: string
      }>
    }
    CapacitorCustomPlatform?: {
      name: string
    }
  }
}

function createMobileE2eUser() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return {
    displayName: 'Mobile Auth User',
    email: `mobile-auth-${suffix}@example.test`,
    password: 'e2e-password',
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.Capacitor = {
      nativeCallback: () => Promise.resolve(`callback-${crypto.randomUUID()}`),
      nativePromise: (pluginName, methodName) => {
        if (pluginName === 'PlannerWidget') {
          switch (methodName) {
            case 'consumePendingCompletedTasks':
            case 'readPendingCompletedTasks':
              return Promise.resolve({ taskIds: [] })

            case 'consumePendingRoute':
              return Promise.resolve({ path: null })

            case 'ackPendingCompletedTasks':
            case 'refresh':
              return Promise.resolve({})
          }
        }

        if (pluginName === 'PushNotifications') {
          switch (methodName) {
            case 'checkPermissions':
            case 'requestPermissions':
              return Promise.resolve({ receive: 'granted' })

            case 'createChannel':
            case 'register':
            case 'removeListener':
              return Promise.resolve({})
          }
        }

        return Promise.resolve({})
      },
      PluginHeaders: [
        {
          methods: [
            { name: 'consumePendingCompletedTasks', rtype: 'promise' },
            { name: 'readPendingCompletedTasks', rtype: 'promise' },
            { name: 'consumePendingRoute', rtype: 'promise' },
            { name: 'ackPendingCompletedTasks', rtype: 'promise' },
            { name: 'refresh', rtype: 'promise' },
          ],
          name: 'PlannerWidget',
        },
        {
          methods: [
            { name: 'addListener', rtype: 'callback' },
            { name: 'removeListener', rtype: 'promise' },
            { name: 'createChannel', rtype: 'promise' },
            { name: 'checkPermissions', rtype: 'promise' },
            { name: 'requestPermissions', rtype: 'promise' },
            { name: 'register', rtype: 'promise' },
          ],
          name: 'PushNotifications',
        },
      ],
    }
    window.CapacitorCustomPlatform = { name: 'android' }

    let documentHidden = false
    const readNativeAuthSessionKey = () =>
      Object.keys(window.localStorage).find((key) =>
        key.endsWith('planner.auth.planner.auth.session'),
      ) ?? null
    const readNativeAuthSession = (): MobileInstalledAuthSession | null => {
      const key = readNativeAuthSessionKey()
      const rawSession = key ? window.localStorage.getItem(key) : null

      if (!rawSession) {
        return null
      }

      const parsedSession = JSON.parse(rawSession) as unknown

      if (!isMobileInstalledAuthSession(parsedSession)) {
        return null
      }

      return parsedSession
    }
    const isMobileInstalledAuthSession = (
      value: unknown,
    ): value is MobileInstalledAuthSession =>
      typeof value === 'object' &&
      value !== null &&
      'accessToken' in value &&
      'email' in value &&
      'expiresAt' in value &&
      'userId' in value &&
      typeof value.accessToken === 'string' &&
      typeof value.email === 'string' &&
      typeof value.expiresAt === 'string' &&
      typeof value.userId === 'string' &&
      (!('refreshToken' in value) || typeof value.refreshToken === 'string')

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => documentHidden,
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (documentHidden ? 'hidden' : 'visible'),
    })

    window.__chaotikaMobileInstalledSmoke = {
      expireNativeAuthSession() {
        const key = readNativeAuthSessionKey()

        if (!key) {
          throw new Error('Native auth session was not persisted.')
        }

        const rawSession = window.localStorage.getItem(key)

        if (!rawSession) {
          throw new Error('Native auth session storage is empty.')
        }

        const session = JSON.parse(rawSession) as {
          expiresAt?: string
        }

        window.localStorage.setItem(
          key,
          JSON.stringify({
            ...session,
            expiresAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        )
      },
      readNativeAuthSession() {
        return readNativeAuthSession()
      },
      setActive(active) {
        documentHidden = !active
        document.dispatchEvent(new Event('visibilitychange'))
      },
    }
  })
})

test('keeps installed mobile auth across cold start, resume, and offline expired-token recovery', async ({
  context,
  page,
}) => {
  const user = createMobileE2eUser()

  await registerUser({ ...user, page })

  await expect
    .poll(() =>
      page.evaluate(() => ({
        isNativePlatform: window.Capacitor?.isNativePlatform?.() ?? false,
        platform: window.Capacitor?.getPlatform?.() ?? 'missing',
      })),
    )
    .toEqual({
      isNativePlatform: true,
      platform: 'android',
    })

  await expect.poll(() => readNativeAuthEmail(page)).toBe(user.email)

  await page.reload()
  await expect(page.getByRole('button', { name: 'Новая задача' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Вход' })).toBeHidden()

  await replayNativeResume(page)
  await expect(page.getByRole('button', { name: 'Новая задача' })).toBeVisible()

  await page.evaluate(() =>
    window.__chaotikaMobileInstalledSmoke?.expireNativeAuthSession(),
  )
  await context.setOffline(true)

  try {
    await replayNativeResume(page)

    await expect(
      page.getByRole('button', { name: 'Новая задача' }),
    ).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Вход' })).toBeHidden()
    await expect
      .poll(() => readDiagnosticEventNames(page))
      .toContain('auth_refresh_deferred')
    await expect
      .poll(() => readDiagnosticEventNames(page))
      .toContain('auth_device_session_kept')
  } finally {
    await context.setOffline(false)
  }

  await replayNativeResume(page)
  await expect(page.getByRole('button', { name: 'Новая задача' })).toBeVisible()
})

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
  await page
    .getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' })
    .click()
  await page.getByLabel('Имя').fill(displayName)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByLabel('Подтвердите пароль').fill(password)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page.getByRole('button', { name: 'Новая задача' })).toBeVisible()
}

async function replayNativeResume(page: Page) {
  await page.evaluate(() => {
    window.__chaotikaMobileInstalledSmoke?.setActive(false)
    window.__chaotikaMobileInstalledSmoke?.setActive(true)
  })
}

async function readNativeAuthEmail(page: Page) {
  return page.evaluate<string | undefined>(
    () => window.__chaotikaMobileInstalledSmoke?.readNativeAuthSession()?.email,
  )
}

async function readDiagnosticEventNames(page: Page) {
  return page.evaluate<string[]>(
    () =>
      window.__CHAOTIKA_DIAGNOSTICS__?.events.map((event) => event.name) ?? [],
  )
}
