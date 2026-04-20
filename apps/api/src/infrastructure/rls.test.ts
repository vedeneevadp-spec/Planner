import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveRlsStrategyForEnvironment } from './db/rls.js'

void describe('resolveRlsStrategyForEnvironment', () => {
  void it('uses a session-scoped connection for Supabase pooler runtime by default', () => {
    const strategy = resolveRlsStrategyForEnvironment({
      DATABASE_URL:
        'postgres://user:password@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
    } as NodeJS.ProcessEnv)

    assert.equal(strategy, 'session_connection')
  })

  void it('uses a session-scoped connection when the runtime url comes from the supabase env alias', () => {
    const strategy = resolveRlsStrategyForEnvironment({
      SUPABASE_RUNTIME_DATABASE_URL:
        'postgres://user:password@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
    } as NodeJS.ProcessEnv)

    assert.equal(strategy, 'session_connection')
  })

  void it('allows explicit disabling regardless of database host', () => {
    const strategy = resolveRlsStrategyForEnvironment({
      API_DB_RLS_MODE: 'disabled',
      DATABASE_URL:
        'postgres://user:password@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
    } as NodeJS.ProcessEnv)

    assert.equal(strategy, 'disabled')
  })

  void it('allows forcing transaction-local RLS when the runtime supports it', () => {
    const strategy = resolveRlsStrategyForEnvironment({
      API_DB_RLS_MODE: 'enabled',
      DATABASE_URL:
        'postgres://user:password@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
    } as NodeJS.ProcessEnv)

    assert.equal(strategy, 'transaction_local')
  })

  void it('uses transaction-local RLS for non-pooler connections', () => {
    const strategy = resolveRlsStrategyForEnvironment({
      DATABASE_URL: 'postgres://user:password@localhost:5432/planner',
    } as NodeJS.ProcessEnv)

    assert.equal(strategy, 'transaction_local')
  })
})
