export async function runRestoreDrillLifecycle({
  cleanup,
  execute,
  onFailure,
  onSuccess,
}) {
  let executionResult
  let executionError = null

  try {
    executionResult = await execute()
  } catch (error) {
    executionError = toError(error)
  }

  let cleanupError = null

  try {
    await cleanup()
  } catch (error) {
    cleanupError = toError(error)
  }

  const lifecycleError = combineLifecycleErrors(executionError, cleanupError)

  if (lifecycleError) {
    await Promise.resolve()
      .then(() => onFailure(lifecycleError))
      .catch(() => undefined)
    throw lifecycleError
  }

  try {
    await onSuccess(executionResult)
  } catch (error) {
    const successReportError = toError(error)

    await Promise.resolve()
      .then(() => onFailure(successReportError))
      .catch(() => undefined)
    throw successReportError
  }

  return executionResult
}

export async function cleanupRestoreDrillResources({
  databaseCleanupRequired,
  drillRolesCreated,
  dropDatabase,
  removeDrillRoles,
  removeTemporaryDirectory,
}) {
  const failures = []
  const cleanupSteps = [
    {
      action: dropDatabase,
      enabled: databaseCleanupRequired,
      label: 'database',
    },
    {
      action: removeDrillRoles,
      enabled: drillRolesCreated.length > 0,
      label: 'roles',
    },
    {
      action: removeTemporaryDirectory,
      enabled: true,
      label: 'temporary directory',
    },
  ]

  for (const step of cleanupSteps) {
    if (!step.enabled) {
      continue
    }

    try {
      await step.action()
    } catch (error) {
      failures.push({ error: toError(error), label: step.label })
    }
  }

  if (failures.length === 0) {
    return
  }

  throw new AggregateError(
    failures.map((failure) => failure.error),
    `Restore drill cleanup failed: ${failures
      .map((failure) => `${failure.label}: ${failure.error.message}`)
      .join('; ')}`,
  )
}

function combineLifecycleErrors(executionError, cleanupError) {
  if (!executionError) {
    return cleanupError
  }

  if (!cleanupError) {
    return executionError
  }

  return new AggregateError(
    [executionError, cleanupError],
    `Restore drill execution failed and cleanup was incomplete: ${executionError.message}; ${cleanupError.message}`,
  )
}

function toError(value) {
  return value instanceof Error ? value : new Error(String(value))
}
