import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { createResticRetentionArgs } from './infrastructure-backup-helpers.mjs'

const directory = await mkdtemp(path.join(os.tmpdir(), 'planner-restic-test-'))
const execute = promisify(execFile)
// Never inherit the operator's repository, password command or cloud credentials.
const env = {
  PATH: process.env.PATH,
  TMPDIR: directory,
  RESTIC_REPOSITORY: path.join(directory, 'repository'),
  RESTIC_PASSWORD: randomBytes(32).toString('hex'),
  RESTIC_CACHE_DIR: path.join(directory, 'cache'),
}
const run = async (args) =>
  (await execute(process.env.RESTIC_BIN ?? 'restic', args, { env })).stdout

try {
  await run(['init'])
  for (let index = 0; index < 4; index++) {
    const source = path.join(directory, `backup-${index}`)
    await mkdir(source)
    await writeFile(path.join(source, 'fixture.txt'), `fixture ${index}`)
    await run([
      'backup',
      source,
      '--host',
      'planner-retention-test',
      '--time',
      `2026-01-05 0${index}:00:00`,
      '--tag',
      'planner',
      ...(index < 3 ? ['--tag', 'kind:infrastructure'] : []),
    ])
  }
  const before = JSON.parse(await run(['snapshots', '--json']))
  assert.equal(before.length, 4)
  const retention = { keepDaily: 1, keepWeekly: 1, keepMonthly: 1 }
  const preview = JSON.parse(
    await run([
      ...createResticRetentionArgs({ ...retention, dryRun: true }),
      '--json',
    ]),
  )
  assert.equal(preview.length, 1, 'timestamp paths must share one host group')
  assert.equal(preview[0].keep.length, 1)
  assert.equal(preview[0].remove.length, 2)
  assert.deepEqual(JSON.parse(await run(['snapshots', '--json'])), before)
  // Actual deletion is restricted to this disposable repository created above.
  await run(createResticRetentionArgs(retention))
  const after = JSON.parse(await run(['snapshots', '--json']))
  assert.equal(after.length, 2)
  assert.ok(after.some((snapshot) => snapshot.paths[0].endsWith('backup-2')))
  assert.ok(after.some((snapshot) => snapshot.paths[0].endsWith('backup-3')))
  await run(['check'])
  console.log(
    'Restic retention passed: 4 fixtures; dry-run selects 2; latest infrastructure and unrelated snapshot survive.',
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
