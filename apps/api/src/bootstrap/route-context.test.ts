import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { areLegacySessionOverridesAllowed } from './route-context.js'

void describe('route context legacy session overrides', () => {
  void test('allows legacy actor headers outside production runtime', () => {
    assert.equal(
      areLegacySessionOverridesAllowed({
        API_AUTH_MODE: 'jwt',
        NODE_ENV: 'test',
      }),
      true,
    )
    assert.equal(
      areLegacySessionOverridesAllowed({
        API_AUTH_MODE: 'disabled',
        NODE_ENV: 'development',
      }),
      true,
    )
  })

  void test('blocks legacy actor headers in production runtime', () => {
    assert.equal(
      areLegacySessionOverridesAllowed({
        API_AUTH_MODE: 'jwt',
        NODE_ENV: 'production',
      }),
      false,
    )
    assert.equal(
      areLegacySessionOverridesAllowed({
        API_AUTH_MODE: 'disabled',
        NODE_ENV: 'production',
      }),
      false,
    )
  })
})
