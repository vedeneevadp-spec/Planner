import { expect, type Page, type Route, test } from '@playwright/test'
import { Client } from 'pg'

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.13' } })

interface MobileInstalledSmokeRuntime {
  expireNativeAuthSession: () => void
  readNativeAuthSession: () => MobileInstalledAuthSession | null
  setActive: (active: boolean) => void
}

interface MobileInstalledAuthSession {
  accessToken: string
  email: string
  expiresAt: string
  refreshRotationRequestId?: string
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
    const createVoiceAssistantStatus = () => ({
      audioFeedbackEnabled: false,
      backgroundWakeWordEnabled: false,
      confirmationMode: 'confirmation_first',
      foregroundServiceStatus: 'stopped',
      isAndroid: true,
      microphonePermission: 'granted',
      notificationPermission: 'granted',
      platform: 'android',
      pushToTalkFallbackStatus: 'available',
      recognitionLanguage: 'ru-RU',
      runtimeDurationMs: 0,
      runtimeLastError: null,
      runtimeMetrics: {},
      runtimeStatus: 'stopped',
      state: 'idle',
      voiceCuesEnabled: true,
      wakePhrase: 'Хаотика',
      wakeWordEnabled: false,
      wakeWordModelStatus: 'ready',
      wakeWordModelVersion: 'test',
      wakeWordProvider: 'mock',
      wakeWordSensitivity: 0.99,
    })

    window.Capacitor = {
      nativeCallback: () => Promise.resolve(`callback-${crypto.randomUUID()}`),
      nativePromise: (pluginName, methodName, options) => {
        if (pluginName === 'PlannerAuthStorage') {
          const input = options as {
            key?: string
            value?: string
          }
          const storageKey = input.key ? `CapacitorStorage.${input.key}` : null

          if (!storageKey) {
            return Promise.reject(new Error('Auth storage key is required.'))
          }

          if (methodName === 'get') {
            return Promise.resolve({
              value: window.localStorage.getItem(storageKey),
            })
          }

          if (methodName === 'set' && typeof input.value === 'string') {
            window.localStorage.setItem(storageKey, input.value)
            return Promise.resolve({})
          }

          if (methodName === 'remove') {
            window.localStorage.removeItem(storageKey)
            return Promise.resolve({})
          }
        }

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

        if (pluginName === 'PlannerVoiceAssistant') {
          switch (methodName) {
            case 'captureCommand':
            case 'start':
              return Promise.resolve({ state: 'idle', wakeWord: 'Хаотика' })

            case 'consumePendingCommand':
              return Promise.resolve({ command: null })

            case 'getStatus':
              return Promise.resolve(createVoiceAssistantStatus())

            case 'getWakeWordDiagnostics':
            case 'openWakeWordDebug':
              return Promise.resolve({
                currentScore: 0,
                detectionCount: 0,
                lastDetectionScore: 0,
                lastError: '',
                lastMetric: '',
                modelVersion: 'test',
                phrase: 'Хаотика',
                provider: 'mock',
                threshold: 0.99,
              })

            case 'getWakeWordTrainingCollectionStatus':
            case 'openWakeWordFalseRejectRecorder':
              return Promise.resolve({
                falseAcceptCount: 0,
                falseRejectCount: 0,
                hasPendingExample: false,
                isEnabled: false,
                storagePath: '',
                trueAcceptCount: 0,
              })

            case 'notifyActionResult':
              return Promise.resolve({
                doneCuePlayed: false,
                successSignalPlayed: false,
              })

            case 'requestMicrophonePermission':
            case 'requestNotificationPermission':
              return Promise.resolve({ status: 'granted' })

            case 'reportWakeWordFalseAccept':
            case 'reportWakeWordTrueAccept':
              return Promise.resolve({
                collectionEnabled: false,
                currentScore: 0,
                detectionCount: 0,
                hadPendingExample: false,
                hasPendingExample: false,
                lastDetectionScore: 0,
                lastError: '',
                lastMetric: '',
                modelVersion: 'test',
                phrase: 'Хаотика',
                provider: 'mock',
                sampleLabel: 'skipped',
                sampleSaved: false,
                threshold: 0.99,
              })

            case 'reportWakeWordFalseReject':
              return Promise.resolve({
                currentScore: 0,
                detectionCount: 0,
                lastDetectionScore: 0,
                lastError: '',
                lastMetric: '',
                modelVersion: 'test',
                phrase: 'Хаотика',
                provider: 'mock',
                threshold: 0.99,
              })

            case 'skipWakeWordFeedback':
              return Promise.resolve({
                collectionEnabled: false,
                currentScore: 0,
                detectionCount: 0,
                hadPendingExample: false,
                hasPendingExample: false,
                lastDetectionScore: 0,
                lastError: '',
                lastMetric: '',
                modelVersion: 'test',
                phrase: 'Хаотика',
                provider: 'mock',
                sampleLabel: 'skipped',
                sampleSaved: false,
                threshold: 0.99,
              })

            case 'openBatteryOptimizationSettings':
            case 'openSystemAppSettings':
            case 'setBackgroundWakeWordEnabled':
            case 'setVoiceCuesEnabled':
            case 'setWakeWordEnabled':
            case 'setWakeWordSensitivity':
            case 'setWakeWordTrainingCollectionEnabled':
              return Promise.resolve({})

            case 'stop':
              return Promise.resolve({ state: 'idle' })
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
            { name: 'get', rtype: 'promise' },
            { name: 'remove', rtype: 'promise' },
            { name: 'set', rtype: 'promise' },
          ],
          name: 'PlannerAuthStorage',
        },
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
            { name: 'captureCommand', rtype: 'promise' },
            { name: 'consumePendingCommand', rtype: 'promise' },
            { name: 'getStatus', rtype: 'promise' },
            { name: 'getWakeWordDiagnostics', rtype: 'promise' },
            { name: 'getWakeWordTrainingCollectionStatus', rtype: 'promise' },
            { name: 'notifyActionResult', rtype: 'promise' },
            { name: 'openBatteryOptimizationSettings', rtype: 'promise' },
            { name: 'openSystemAppSettings', rtype: 'promise' },
            { name: 'openWakeWordDebug', rtype: 'promise' },
            { name: 'openWakeWordFalseRejectRecorder', rtype: 'promise' },
            { name: 'reportWakeWordFalseAccept', rtype: 'promise' },
            { name: 'reportWakeWordFalseReject', rtype: 'promise' },
            { name: 'reportWakeWordTrueAccept', rtype: 'promise' },
            { name: 'requestMicrophonePermission', rtype: 'promise' },
            { name: 'requestNotificationPermission', rtype: 'promise' },
            { name: 'setBackgroundWakeWordEnabled', rtype: 'promise' },
            { name: 'setVoiceCuesEnabled', rtype: 'promise' },
            { name: 'setWakeWordEnabled', rtype: 'promise' },
            { name: 'setWakeWordSensitivity', rtype: 'promise' },
            { name: 'setWakeWordTrainingCollectionEnabled', rtype: 'promise' },
            { name: 'skipWakeWordFeedback', rtype: 'promise' },
            { name: 'start', rtype: 'promise' },
            { name: 'stop', rtype: 'promise' },
          ],
          name: 'PlannerVoiceAssistant',
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
      (!('refreshRotationRequestId' in value) ||
        typeof value.refreshRotationRequestId === 'string') &&
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

test('recovers after a committed rotation response is lost and the old token remains stored for more than five minutes', async ({
  page,
}) => {
  const user = createMobileE2eUser()

  await registerUser({ ...user, page })

  const initialSession = await readNativeAuthSession(page)

  expect(initialSession?.refreshToken).toBeTruthy()
  expect(initialSession?.refreshRotationRequestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )

  let interceptedRefreshCount = 0
  const loseCommittedRefreshResponse = async (route: Route) => {
    const response = await route.fetch()

    expect(response.ok()).toBe(true)
    interceptedRefreshCount += 1
    await route.abort('connectionfailed')
  }

  await page.route('**/api/v1/auth/refresh', loseCommittedRefreshResponse)
  await page.evaluate(() =>
    window.__chaotikaMobileInstalledSmoke?.expireNativeAuthSession(),
  )
  await replayNativeResume(page)

  await expect.poll(() => interceptedRefreshCount).toBe(2)
  await expect
    .poll(() => readDiagnosticEventNames(page))
    .toContain('auth_refresh_deferred')

  const sessionAfterLostResponse = await readNativeAuthSession(page)

  expect(sessionAfterLostResponse).toMatchObject({
    refreshRotationRequestId: initialSession?.refreshRotationRequestId,
    refreshToken: initialSession?.refreshToken,
    userId: initialSession?.userId,
  })
  expect(sessionAfterLostResponse?.refreshRotationRequestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )

  await ageCommittedRefreshRotation(initialSession!.userId)
  await page.unroute('**/api/v1/auth/refresh', loseCommittedRefreshResponse)
  await page.reload()

  await expect(page.getByRole('button', { name: 'Новая задача' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Вход' })).toBeHidden()

  const recoveredSession = await readNativeAuthSession(page)

  expect(recoveredSession?.refreshToken).toBeTruthy()
  expect(recoveredSession?.refreshToken).not.toBe(initialSession?.refreshToken)
  expect(recoveredSession?.refreshRotationRequestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  expect(recoveredSession?.refreshRotationRequestId).not.toBe(
    sessionAfterLostResponse?.refreshRotationRequestId,
  )
  await expectNoRevokedRefreshTokens(initialSession!.userId)
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

async function readNativeAuthSession(
  page: Page,
): Promise<MobileInstalledAuthSession | null> {
  return page.evaluate(
    () =>
      window.__chaotikaMobileInstalledSmoke?.readNativeAuthSession() ?? null,
  )
}

async function readDiagnosticEventNames(page: Page) {
  return page.evaluate<string[]>(
    () =>
      window.__CHAOTIKA_DIAGNOSTICS__?.events.map((event) => event.name) ?? [],
  )
}

async function ageCommittedRefreshRotation(userId: string): Promise<void> {
  const client = createDatabaseClient()

  await client.connect()

  try {
    const result = await client.query(
      `
        update app.auth_refresh_tokens
        set rotated_at = now() - interval '6 minutes'
        where user_id = $1::uuid
          and replaced_by_token_id is not null
          and revoked_at is null
      `,
      [userId],
    )

    expect(result.rowCount).toBe(1)
  } finally {
    await client.end()
  }
}

async function expectNoRevokedRefreshTokens(userId: string): Promise<void> {
  const client = createDatabaseClient()

  await client.connect()

  try {
    const result = await client.query<{ revoked_count: string }>(
      `
        select count(*) filter (where revoked_at is not null) as revoked_count
        from app.auth_refresh_tokens
        where user_id = $1::uuid
      `,
      [userId],
    )

    expect(Number(result.rows[0]?.revoked_count ?? 0)).toBe(0)
  } finally {
    await client.end()
  }
}

function createDatabaseClient(): Client {
  return new Client({
    connectionString:
      process.env.DATABASE_URL ??
      'postgres://planner:planner@127.0.0.1:54329/planner_development',
  })
}
