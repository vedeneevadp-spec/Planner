import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isAllowedEslintToolingVulnerability } from './audit-dev-tooling-policy.mjs'

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
