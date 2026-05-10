import { defineConfig, devices } from '@playwright/test'

const apiPort = process.env.E2E_API_PORT ?? '3102'
const webPort = process.env.E2E_WEB_PORT ?? '5174'
const apiBaseUrl = `http://127.0.0.1:${apiPort}`
const webBaseUrl = `http://127.0.0.1:${webPort}`
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
      command: [
        'NODE_ENV=production',
        'API_AUTH_MODE=jwt',
        'API_CORS_ORIGIN=http://127.0.0.1:5174',
        'API_DB_RLS_MODE=transaction_local',
        'API_HOST=127.0.0.1',
        `API_PORT=${apiPort}`,
        'API_STORAGE_DRIVER=postgres',
        'AUTH_JWT_SECRET=planner-e2e-jwt-secret-with-at-least-32-chars',
        `DATABASE_URL=${databaseUrl}`,
        'npm run -w apps/api start',
      ].join(' '),
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      url: `${apiBaseUrl}/api/health`,
    },
    {
      command: [
        `VITE_API_BASE_URL=${apiBaseUrl}`,
        'VITE_AUTH_PROVIDER=planner',
        `npm run dev -- --host 127.0.0.1 --port ${webPort} --strictPort`,
      ].join(' '),
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      url: webBaseUrl,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
