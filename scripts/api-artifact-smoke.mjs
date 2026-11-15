import { copyFile, cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { npmCommand, runCommand } from './command-utils.mjs'

const root = process.cwd()
const directory = await mkdtemp(
  path.join(os.tmpdir(), 'planner-production-smoke-'),
)
try {
  await runCommand(npmCommand(), ['run', 'build:api'])
  for (const file of [
    'package.json',
    'package-lock.json',
    'apps/api/package.json',
    'apps/web/package.json',
    'packages/contracts/package.json',
    'scripts/api-prod-smoke.mjs',
  ]) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true })
    await copyFile(path.join(root, file), path.join(directory, file))
  }
  await cp(
    path.join(root, 'apps/api/dist'),
    path.join(directory, 'apps/api/dist'),
    { recursive: true },
  )
  // Install outside the repository: Node cannot accidentally resolve dev tooling
  // from this checkout's parent node_modules.
  await runCommand(
    npmCommand(),
    ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: directory },
  )
  await runCommand(
    process.execPath,
    [path.join(directory, 'scripts/api-prod-smoke.mjs')],
    {
      cwd: directory,
      env: process.env,
    },
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
