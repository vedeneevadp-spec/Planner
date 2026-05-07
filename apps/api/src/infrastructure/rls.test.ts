import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveRlsStrategyForEnvironment } from './db/rls.js'

void describe('resolveRlsStrategyForEnvironment', () => {
  void it('uses transaction-local RLS by default', () => {
    const strategy = resolveRlsStrategyForEnvironment({
      DATABASE_URL: 'postgres://user:password@localhost:5432/planner',
    } as NodeJS.ProcessEnv)

    assert.equal(strategy, 'transaction_local')
  })

  void it('allows explicit disabling regardless of database host', () => {
    const strategy = resolveRlsStrategyForEnvironment({
      API_DB_RLS_MODE: 'disabled',
      DATABASE_URL: 'postgres://user:password@localhost:5432/planner',
    } as NodeJS.ProcessEnv)

    assert.equal(strategy, 'disabled')
  })

  void it('allows forcing transaction-local RLS when the runtime supports it', () => {
    const strategy = resolveRlsStrategyForEnvironment({
      API_DB_RLS_MODE: 'enabled',
      DATABASE_URL: 'postgres://user:password@localhost:5432/planner',
    } as NodeJS.ProcessEnv)

    assert.equal(strategy, 'transaction_local')
  })

  void it('allows forcing session-connection RLS for compatible runtimes', () => {
    const strategy = resolveRlsStrategyForEnvironment({
      API_DB_RLS_MODE: 'session_connection',
      DATABASE_URL: 'postgres://user:password@localhost:5432/planner',
    } as NodeJS.ProcessEnv)

    assert.equal(strategy, 'session_connection')
  })
})
