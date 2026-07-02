import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertCoverageHotspots,
  runAndCapture,
  writeCoverageLog,
} from './coverage-hotspot-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const logPath = path.join(repoRoot, 'coverage', 'api-postgres-coverage.txt')

const contractOutput = await runAndCapture(
  'npm',
  ['run', 'coverage:api:postgres-contracts'],
  { cwd: repoRoot },
)
const poolerOutput = await runAndCapture(
  'npm',
  ['run', 'coverage:api:postgres-pooler-contracts'],
  { cwd: repoRoot },
)
const output = `${contractOutput}\n${poolerOutput}`

await writeCoverageLog(logPath, output)
assertCoverageHotspots(output, [
  { file: 'self-care.repository.postgres.helpers.ts', minLines: 65 },
  { file: 'self-care.repository.postgres.ts', minLines: 65 },
])

console.log('API Postgres coverage hotspot guard passed.')
