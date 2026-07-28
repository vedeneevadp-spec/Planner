import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { evaluateProductionAudit } from './audit-prod-policy.mjs'

const exceptionDate = new Date('2026-07-28T00:00:00.000Z')
const spaPackage = {
  dependencies: {
    'react-router-dom': '^7.18.1',
  },
}

void describe('production audit policy', () => {
  void it('allows only the React Router RSC advisory for the SPA', () => {
    const result = evaluateProductionAudit(
      createReactRouterAudit(),
      spaPackage,
      exceptionDate,
    )

    assert.deepEqual(
      result.allowed.map((vulnerability) => vulnerability.name),
      ['react-router', 'react-router-dom'],
    )
    assert.deepEqual(result.unexpected, [])
  })

  void it('rejects the exception when an RSC package is installed', () => {
    const result = evaluateProductionAudit(
      createReactRouterAudit(),
      {
        dependencies: {
          ...spaPackage.dependencies,
          'react-server-dom-webpack': '^19.2.0',
        },
      },
      exceptionDate,
    )

    assert.equal(result.allowed.length, 0)
    assert.equal(result.unexpected.length, 2)
  })

  void it('rejects the exception after its expiry', () => {
    const result = evaluateProductionAudit(
      createReactRouterAudit(),
      spaPackage,
      new Date('2026-08-31T00:00:00.000Z'),
    )

    assert.equal(result.allowed.length, 0)
    assert.equal(result.unexpected.length, 2)
  })

  void it('rejects additional production vulnerabilities', () => {
    const audit = createReactRouterAudit()

    audit.vulnerabilities['unexpected-package'] = {
      name: 'unexpected-package',
      nodes: ['node_modules/unexpected-package'],
      severity: 'high',
      via: [
        {
          name: 'unexpected-package',
          url: 'https://github.com/advisories/GHSA-unexpected',
        },
      ],
    }

    const result = evaluateProductionAudit(audit, spaPackage, exceptionDate)

    assert.deepEqual(
      result.unexpected.map((vulnerability) => vulnerability.name),
      ['unexpected-package'],
    )
  })

  void it('rejects a changed advisory chain', () => {
    const audit = createReactRouterAudit()

    audit.vulnerabilities['react-router'].via.push({
      name: 'react-router',
      url: 'https://github.com/advisories/GHSA-another-advisory',
    })

    const result = evaluateProductionAudit(audit, spaPackage, exceptionDate)

    assert.equal(result.allowed.length, 0)
    assert.equal(result.unexpected.length, 2)
  })

  void it('rejects an unsuccessful npm audit response', () => {
    assert.throws(
      () =>
        evaluateProductionAudit(
          {
            error: {
              code: 'EAI_AGAIN',
              summary: 'request to the registry failed',
            },
          },
          spaPackage,
          exceptionDate,
        ),
      /invalid or unsuccessful JSON result/,
    )
  })
})

function createReactRouterAudit() {
  return {
    vulnerabilities: {
      'react-router': {
        name: 'react-router',
        nodes: ['node_modules/react-router'],
        severity: 'high',
        via: [
          {
            name: 'react-router',
            url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
          },
        ],
      },
      'react-router-dom': {
        name: 'react-router-dom',
        nodes: ['node_modules/react-router-dom'],
        severity: 'high',
        via: ['react-router'],
      },
    },
  }
}
