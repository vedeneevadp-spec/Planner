import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertCoverageHotspots,
  runAndCapture,
  writeCoverageLog,
} from './coverage-hotspot-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const logPath = path.join(repoRoot, 'coverage', 'api-coverage.txt')

const output = await runAndCapture(
  'npm',
  ['run', '-w', 'apps/api', 'coverage'],
  {
    cwd: repoRoot,
  },
)

await writeCoverageLog(logPath, output)
assertCoverageHotspots(output, [
  { file: 'mcp-haotika.server.ts', minLines: 45 },
  { file: 'openapi-components.ts', minLines: 95 },
  { file: 'openapi-contract-schemas.ts', minLines: 95 },
  { file: 'openapi-paths.ts', minLines: 95 },
  { file: 'self-care.shared.ts', minLines: 90 },
])

console.log('API coverage hotspot guard passed.')
