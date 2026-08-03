import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { evaluateProductionAudit } from './audit-prod-policy.mjs'

void describe('production audit policy', () => {
  void it('accepts a clean production audit', () => {
    assert.deepEqual(evaluateProductionAudit({ vulnerabilities: {} }), {
      unexpected: [],
    })
  })

  void it('does not exempt the previous React Router advisory', () => {
    const vulnerability = {
      name: 'react-router',
      nodes: ['apps/web/node_modules/react-router'],
      severity: 'high',
      via: [
        {
          name: 'react-router',
          url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
        },
      ],
    }

    const result = evaluateProductionAudit({
      vulnerabilities: { 'react-router': vulnerability },
    })

    assert.deepEqual(result.unexpected, [vulnerability])
  })

  void it('rejects an unsuccessful npm audit response', () => {
    assert.throws(
      () =>
        evaluateProductionAudit({
          error: {
            code: 'EAI_AGAIN',
            summary: 'request to the registry failed',
          },
        }),
      /invalid or unsuccessful JSON result/,
    )
  })
})
