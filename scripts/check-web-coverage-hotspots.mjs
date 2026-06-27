import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const SUMMARY_PATH = new URL(
  '../apps/web/coverage/coverage-summary.json',
  import.meta.url,
)

const HOTSPOTS = [
  {
    metric: 'lines',
    min: 7,
    path: 'apps/web/src/features/self-care/lib/useSelfCare.ts',
  },
  {
    metric: 'lines',
    min: 55,
    path: 'apps/web/src/features/self-care/lib/self-care-api.ts',
  },
  {
    metric: 'lines',
    min: 70,
    path: 'apps/web/src/features/session/lib/useSessionAuthController.ts',
  },
  {
    metric: 'lines',
    min: 5,
    path: 'apps/web/src/features/session/lib/native-push-notifications.ts',
  },
  {
    metric: 'lines',
    min: 60,
    path: 'apps/web/src/features/session/lib/workspace-participants-api.ts',
  },
]

const summary = JSON.parse(await readFile(SUMMARY_PATH, 'utf8'))

for (const hotspot of HOTSPOTS) {
  const fileSummary = findFileSummary(summary, hotspot.path)

  assert.ok(
    fileSummary,
    `Coverage hotspot is missing from summary: ${hotspot.path}`,
  )

  const metric = fileSummary[hotspot.metric]
  const pct = typeof metric?.pct === 'number' ? metric.pct : null

  assert.ok(
    pct !== null,
    `Coverage hotspot ${hotspot.path} is missing ${hotspot.metric}.pct.`,
  )
  assert.ok(
    pct >= hotspot.min,
    [
      `Coverage hotspot ${hotspot.path} ${hotspot.metric} is ${pct}%.`,
      `Expected at least ${hotspot.min}%.`,
      'Add focused tests or update this guard with an explicit rationale.',
    ].join(' '),
  )
}

console.log('Web coverage hotspot guard passed.')

function findFileSummary(summary, path) {
  const normalizedPath = normalizePath(path)

  for (const [summaryPath, fileSummary] of Object.entries(summary)) {
    if (summaryPath === 'total') {
      continue
    }

    if (normalizePath(summaryPath).endsWith(normalizedPath)) {
      return fileSummary
    }
  }

  return null
}

function normalizePath(path) {
  return path.replaceAll('\\', '/')
}
