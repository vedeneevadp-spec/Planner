import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  isAllowedEslintToolingVulnerability,
  isAllowedLegacyMinimatchToolingVulnerability,
} from './audit-dev-tooling-policy.mjs'

const exceptionDate = new Date('2026-07-28T00:00:00.000Z')
const packageJson = {
  dependencies: {
    pg: '^8.22.0',
  },
  devDependencies: {
    eslint: '^9.39.5',
    'eslint-plugin-jsx-a11y': '^6.10.2',
  },
}

void describe('dev tooling audit policy', () => {
  void it('allows the exact dev-only ESLint node', () => {
    assert.equal(
      isAllowedEslintToolingVulnerability(
        {
          name: 'eslint',
          nodes: ['node_modules/eslint'],
          severity: 'high',
          via: ['@eslint/config-array', '@eslint/eslintrc', 'minimatch'],
        },
        packageJson,
        exceptionDate,
      ),
      true,
    )
  })

  void it('rejects an unexpected dependency path', () => {
    assert.equal(
      isAllowedEslintToolingVulnerability(
        {
          name: 'brace-expansion',
          nodes: ['node_modules/brace-expansion'],
          severity: 'high',
          via: [
            {
              url: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
            },
          ],
        },
        packageJson,
        exceptionDate,
      ),
      false,
    )
  })

  void it('rejects the exception when ESLint is a runtime dependency', () => {
    assert.equal(
      isAllowedEslintToolingVulnerability(
        {
          name: 'eslint',
          nodes: ['node_modules/eslint'],
          severity: 'high',
          via: ['@eslint/config-array', '@eslint/eslintrc', 'minimatch'],
        },
        {
          dependencies: {
            eslint: '^9.39.5',
          },
        },
        exceptionDate,
      ),
      false,
    )
  })

  void it('rejects critical vulnerabilities', () => {
    assert.equal(
      isAllowedEslintToolingVulnerability(
        {
          name: 'eslint',
          nodes: ['node_modules/eslint'],
          severity: 'critical',
          via: ['@eslint/config-array', '@eslint/eslintrc', 'minimatch'],
        },
        packageJson,
        exceptionDate,
      ),
      false,
    )
  })

  void it('rejects the exception after its expiry', () => {
    assert.equal(
      isAllowedEslintToolingVulnerability(
        {
          name: 'eslint',
          nodes: ['node_modules/eslint'],
          severity: 'high',
          via: ['@eslint/config-array', '@eslint/eslintrc', 'minimatch'],
        },
        packageJson,
        new Date('2026-08-31T00:00:00.000Z'),
      ),
      false,
    )
  })

  void it('rejects a changed advisory chain', () => {
    assert.equal(
      isAllowedEslintToolingVulnerability(
        {
          name: 'brace-expansion',
          nodes: [
            'node_modules/@eslint/config-array/node_modules/brace-expansion',
          ],
          severity: 'high',
          via: [
            {
              url: 'https://github.com/advisories/GHSA-unexpected',
            },
          ],
        },
        packageJson,
        exceptionDate,
      ),
      false,
    )
  })
})

void describe('legacy minimatch advisory scope', () => {
  const reviewedAt = new Date('2026-11-02T00:00:00.000Z')
  const minimatchPath = 'node_modules/eslint/node_modules/minimatch'

  function fixture() {
    return {
      audit: {
        vulnerabilities: {
          minimatch: {
            name: 'minimatch',
            severity: 'moderate',
            nodes: [minimatchPath],
            via: [
              {
                name: 'minimatch',
                severity: 'moderate',
                url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249',
              },
            ],
          },
          eslint: {
            name: 'eslint',
            severity: 'moderate',
            nodes: ['node_modules/eslint'],
            via: ['minimatch', 'eslint-utils'],
          },
          'eslint-utils': {
            name: 'eslint-utils',
            severity: 'moderate',
            nodes: ['node_modules/eslint-utils'],
            via: ['eslint'],
          },
        },
      },
      lock: {
        packages: {
          [minimatchPath]: { version: '3.1.5', dev: true },
          'node_modules/eslint': { version: '9.39.5', dev: true },
          'node_modules/eslint-utils': { version: '4.9.0', dev: true },
        },
      },
    }
  }

  function accepts({ audit, lock }, name = 'eslint', at = reviewedAt) {
    return isAllowedLegacyMinimatchToolingVulnerability(
      audit.vulnerabilities[name],
      audit,
      lock,
      at,
    )
  }

  void it('accepts the reviewed dev-only advisory and its cyclic parent chain', () => {
    const data = fixture()
    for (const name of Object.keys(data.audit.vulnerabilities)) {
      assert.equal(accepts(data, name), true)
    }
  })

  void it('rejects runtime nodes anywhere in the chain', () => {
    for (const path of [minimatchPath, 'node_modules/eslint-utils']) {
      const data = fixture()
      delete data.lock.packages[path].dev
      assert.equal(accepts(data), false)
    }
  })

  void it('rejects unreviewed versions and dependency paths', () => {
    const data = fixture()
    data.lock.packages[minimatchPath].version = '10.2.5'
    assert.equal(accepts(data), false)

    data.lock.packages[minimatchPath].version = '3.1.5'
    data.audit.vulnerabilities.minimatch.nodes.push('node_modules/minimatch')
    data.lock.packages['node_modules/minimatch'] = {
      version: '3.1.5',
      dev: true,
    }
    assert.equal(accepts(data), false)
  })

  void it('rejects a different or additional advisory', () => {
    const data = fixture()
    const advisory = data.audit.vulnerabilities.minimatch.via[0]
    advisory.url = 'https://github.com/advisories/GHSA-unreviewed'
    assert.equal(accepts(data), false)

    const extra = fixture()
    extra.audit.vulnerabilities.eslint.via.push(advisory)
    assert.equal(accepts(extra), false)
  })

  void it('rejects increased severity at any level', () => {
    for (const name of Object.keys(fixture().audit.vulnerabilities)) {
      const data = fixture()
      data.audit.vulnerabilities[name].severity = 'high'
      assert.equal(accepts(data), false)
    }
  })

  void it('rejects missing lockfile entries and missing audit references', () => {
    const data = fixture()
    delete data.lock.packages[minimatchPath]
    assert.equal(accepts(data), false)

    const missing = fixture()
    delete missing.audit.vulnerabilities.minimatch
    assert.equal(accepts(missing), false)
  })

  void it('rejects empty chains and cycles without the reviewed advisory', () => {
    const data = fixture()
    data.audit.vulnerabilities.eslint.via = ['eslint-utils']
    assert.equal(accepts(data), false)
    data.audit.vulnerabilities.eslint.via = []
    assert.equal(accepts(data), false)
  })

  void it('expires automatically and rejects an invalid review date', () => {
    assert.equal(accepts(fixture(), 'eslint', new Date('2026-12-02')), false)
    assert.equal(accepts(fixture(), 'eslint', new Date('invalid')), false)
  })
})
