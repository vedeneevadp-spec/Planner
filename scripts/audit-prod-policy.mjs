export function evaluateProductionAudit(audit) {
  assertValidNpmAuditResult(audit)

  return {
    unexpected: Object.values(audit.vulnerabilities ?? {}),
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
