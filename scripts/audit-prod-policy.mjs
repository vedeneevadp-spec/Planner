const REACT_ROUTER_RSC_ADVISORY =
  'https://github.com/advisories/GHSA-qwww-vcr4-c8h2'
const REACT_ROUTER_RSC_EXCEPTION_EXPIRES_AT = '2026-08-31T00:00:00.000Z'
const REACT_ROUTER_RSC_PACKAGES = new Set([
  '@react-router/dev',
  '@react-router/node',
  '@react-router/serve',
  'react-server-dom-parcel',
  'react-server-dom-turbopack',
  'react-server-dom-vite',
  'react-server-dom-webpack',
])

export function evaluateProductionAudit(audit, webPackage, now = new Date()) {
  assertValidNpmAuditResult(audit)

  const vulnerabilities = Object.values(audit.vulnerabilities ?? {})
  const reactRouter = vulnerabilities.find(
    (vulnerability) => vulnerability.name === 'react-router',
  )
  const allowed = vulnerabilities.filter((vulnerability) =>
    isAllowedReactRouterRscVulnerability(
      vulnerability,
      reactRouter,
      webPackage,
      now,
    ),
  )
  const allowedNames = new Set(
    allowed.map((vulnerability) => vulnerability.name),
  )

  return {
    allowed,
    unexpected: vulnerabilities.filter(
      (vulnerability) => !allowedNames.has(vulnerability.name),
    ),
  }
}

export function assertValidNpmAuditResult(audit) {
  if (
    !audit ||
    typeof audit !== 'object' ||
    audit.error ||
    !audit.vulnerabilities ||
    typeof audit.vulnerabilities !== 'object' ||
    Array.isArray(audit.vulnerabilities)
  ) {
    throw new Error(
      'npm audit returned an invalid or unsuccessful JSON result.',
    )
  }
}

export function getProductionAuditExceptionSummary() {
  return {
    advisory: REACT_ROUTER_RSC_ADVISORY,
    expiresAt: REACT_ROUTER_RSC_EXCEPTION_EXPIRES_AT,
  }
}

function isAllowedReactRouterRscVulnerability(
  vulnerability,
  reactRouter,
  webPackage,
  now,
) {
  if (
    now >= new Date(REACT_ROUTER_RSC_EXCEPTION_EXPIRES_AT) ||
    usesReactServerComponents(webPackage)
  ) {
    return false
  }

  if (vulnerability.name === 'react-router') {
    return (
      hasOnlyNodes(vulnerability, ['node_modules/react-router']) &&
      hasOnlyAdvisory(vulnerability, REACT_ROUTER_RSC_ADVISORY)
    )
  }

  if (vulnerability.name === 'react-router-dom') {
    return (
      reactRouter !== undefined &&
      hasOnlyNodes(vulnerability, ['node_modules/react-router-dom']) &&
      hasOnlyViaNames(vulnerability, ['react-router']) &&
      hasOnlyAdvisory(reactRouter, REACT_ROUTER_RSC_ADVISORY)
    )
  }

  return false
}

function usesReactServerComponents(webPackage) {
  const dependencies = {
    ...webPackage.dependencies,
    ...webPackage.devDependencies,
  }

  return Object.keys(dependencies).some(
    (name) =>
      REACT_ROUTER_RSC_PACKAGES.has(name) ||
      name.startsWith('react-server-dom-'),
  )
}

function hasOnlyAdvisory(vulnerability, advisoryUrl) {
  const via = vulnerability.via ?? []

  return (
    via.length > 0 &&
    via.every((entry) => typeof entry !== 'string' && entry.url === advisoryUrl)
  )
}

function hasOnlyNodes(vulnerability, expectedNodes) {
  const nodes = [...(vulnerability.nodes ?? [])].sort()

  return JSON.stringify(nodes) === JSON.stringify([...expectedNodes].sort())
}

function hasOnlyViaNames(vulnerability, expectedNames) {
  const names = (vulnerability.via ?? [])
    .map((entry) => (typeof entry === 'string' ? entry : entry.name))
    .sort()

  return JSON.stringify(names) === JSON.stringify([...expectedNames].sort())
}
