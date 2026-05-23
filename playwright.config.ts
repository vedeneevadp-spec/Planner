import { defineConfig, devices } from '@playwright/test'

const apiPort = process.env.E2E_API_PORT ?? '3102'
const webPort = process.env.E2E_WEB_PORT ?? '5174'
const apiBaseUrl = `http://127.0.0.1:${apiPort}`
const webBaseUrl = `http://127.0.0.1:${webPort}`
const reuseExistingServer = process.env.E2E_REUSE_EXISTING_SERVER === '1'
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  testDir: './tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: webBaseUrl,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run -w apps/api start',
      env: {
        API_AUTH_MODE: 'jwt',
        API_CORS_ORIGIN: webBaseUrl,
        API_DB_RLS_MODE: 'transaction_local',
        API_HOST: '127.0.0.1',
        API_PORT: apiPort,
        API_STORAGE_DRIVER: 'postgres',
        AUTH_JWT_SECRET: 'planner-e2e-jwt-secret-with-at-least-32-chars',
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
      },
      reuseExistingServer,
      timeout: 30_000,
      url: `${apiBaseUrl}/api/health`,
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${webPort} --strictPort`,
      env: {
        VITE_API_BASE_URL: apiBaseUrl,
        VITE_AUTH_PROVIDER: 'planner',
      },
      reuseExistingServer,
      timeout: 30_000,
      url: webBaseUrl,
    },
  ],
  projects: [
    {
      name: 'chromium',
      testIgnore: /mobile-auth-installed\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-installed-auth',
      testMatch: /mobile-auth-installed\.spec\.ts/,
      use: {
        ...devices['Pixel 5'],
      },
    },
  ],
})
