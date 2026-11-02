const ESLINT_TOOLING_EXCEPTION_EXPIRES_AT = '2026-08-31T00:00:00.000Z'
const LEGACY_MINIMATCH_EXCEPTION_EXPIRES_AT = '2026-12-02T00:00:00.000Z'
const LEGACY_MINIMATCH_ADVISORY =
  'https://github.com/advisories/GHSA-g3hv-75wg-m249'
const LEGACY_MINIMATCH_NODES = new Set([
  'node_modules/@eslint/config-array/node_modules/minimatch',
  'node_modules/@eslint/eslintrc/node_modules/minimatch',
  'node_modules/eslint-plugin-jsx-a11y/node_modules/minimatch',
  'node_modules/eslint/node_modules/minimatch',
])
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
    legacyMinimatchExpiresAt: LEGACY_MINIMATCH_EXCEPTION_EXPIRES_AT,
  }
}

// GHSA-g3hv-75wg-m249 describes firstPhasePreProcess/optimizationLevel >= 2.
// The four pinned minimatch 3.1.5 copies have neither implementation. Their
// consumers still need the old callable CommonJS export, so overriding them
// with minimatch 11 breaks ESLint. Modern consumers use the patched version.
// Bound this exception to the reviewed dev-only copies and their audit chains;
// a new advisory, version, runtime path, severity or expired review fails closed.
export function isAllowedLegacyMinimatchToolingVulnerability(
  vulnerability,
  audit,
  packageLock,
  now = new Date(),
) {
  if (!(now < new Date(LEGACY_MINIMATCH_EXCEPTION_EXPIRES_AT))) {
    return false
  }

  const visited = new Set()
  let reachesReviewedMinimatch = false

  function visit(entry) {
    if (!entry || entry.severity !== 'moderate') return false
    if (visited.has(entry.name)) return true
    visited.add(entry.name)

    const nodes = entry.nodes ?? []
    if (
      nodes.length === 0 ||
      !nodes.every((node) => packageLock.packages?.[node]?.dev === true)
    ) {
      return false
    }

    const via = entry.via ?? []
    if (entry.name === 'minimatch') {
      const reviewed =
        nodes.every(
          (node) =>
            LEGACY_MINIMATCH_NODES.has(node) &&
            packageLock.packages[node].version === '3.1.5',
        ) &&
        via.length === 1 &&
        typeof via[0] === 'object' &&
        via[0]?.name === 'minimatch' &&
        via[0]?.url === LEGACY_MINIMATCH_ADVISORY &&
        via[0]?.severity === 'moderate'
      reachesReviewedMinimatch ||= reviewed
      return reviewed
    }

    return (
      via.length > 0 &&
      via.every(
        (source) =>
          typeof source === 'string' && visit(audit.vulnerabilities?.[source]),
      )
    )
  }

  return visit(vulnerability) && reachesReviewedMinimatch
}
