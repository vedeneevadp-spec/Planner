const ESLINT_TOOLING_EXCEPTION_EXPIRES_AT = '2026-08-31T00:00:00.000Z'
const BRACE_EXPANSION_ADVISORY =
  'https://github.com/advisories/GHSA-mh99-v99m-4gvg'
const ALLOWED_ESLINT_NODES = new Map([
  ['@eslint/config-array', ['node_modules/@eslint/config-array']],
  ['@eslint/eslintrc', ['node_modules/@eslint/eslintrc']],
  [
    'brace-expansion',
    [
      'node_modules/@eslint/config-array/node_modules/brace-expansion',
      'node_modules/@eslint/eslintrc/node_modules/brace-expansion',
      'node_modules/eslint-plugin-jsx-a11y/node_modules/brace-expansion',
      'node_modules/eslint/node_modules/brace-expansion',
    ],
  ],
  ['eslint', ['node_modules/eslint']],
  ['eslint-plugin-jsx-a11y', ['node_modules/eslint-plugin-jsx-a11y']],
  [
    'minimatch',
    [
      'node_modules/@eslint/config-array/node_modules/minimatch',
      'node_modules/@eslint/eslintrc/node_modules/minimatch',
      'node_modules/eslint-plugin-jsx-a11y/node_modules/minimatch',
      'node_modules/eslint/node_modules/minimatch',
    ],
  ],
])
const ALLOWED_ESLINT_VIA = new Map([
  ['@eslint/config-array', ['minimatch']],
  ['@eslint/eslintrc', ['minimatch']],
  ['brace-expansion', [BRACE_EXPANSION_ADVISORY]],
  ['eslint', ['@eslint/config-array', '@eslint/eslintrc', 'minimatch']],
  ['eslint-plugin-jsx-a11y', ['minimatch']],
  ['minimatch', ['brace-expansion']],
])

export function isAllowedEslintToolingVulnerability(
  vulnerability,
  packageJson,
  now = new Date(),
) {
  const expectedNodes = ALLOWED_ESLINT_NODES.get(vulnerability.name)
  const expectedVia = ALLOWED_ESLINT_VIA.get(vulnerability.name)

  if (
    !expectedNodes ||
    !expectedVia ||
    vulnerability.severity === 'critical' ||
    now >= new Date(ESLINT_TOOLING_EXCEPTION_EXPIRES_AT)
  ) {
    return false
  }

  if (
    packageJson.dependencies?.eslint ||
    packageJson.dependencies?.['eslint-plugin-jsx-a11y']
  ) {
    return false
  }

  const nodes = [...(vulnerability.nodes ?? [])].sort()
  const via = (vulnerability.via ?? [])
    .map((entry) => (typeof entry === 'string' ? entry : entry.url))
    .sort()

  return (
    nodes.length > 0 &&
    nodes.every((node) => expectedNodes.includes(node)) &&
    JSON.stringify(via) === JSON.stringify([...expectedVia].sort())
  )
}

export function getDevToolingAuditExceptionSummary() {
  return {
    expiresAt: ESLINT_TOOLING_EXCEPTION_EXPIRES_AT,
  }
}
