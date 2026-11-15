import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('rejects nontransactional migration modes before opening a database connection', () => {
  for (const mode of ['stateless', 'typo']) {
    const result = spawnSync(process.execPath, ['scripts/db-migrate.mjs'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      timeout: 2000,
      env: {
        ...process.env,
        DB_MIGRATE_MODE: mode,
        MIGRATE_DATABASE_URL: 'postgres://invalid@127.0.0.1:9/never_connect',
      },
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Only transactional migrations are supported/)
    assert.doesNotMatch(result.stdout, /Retry|Connected|Applying migration/)
  }
})
