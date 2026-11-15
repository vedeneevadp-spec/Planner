import { stat, readdir } from 'node:fs/promises'
import path from 'node:path'
const repoRoot = process.cwd()
export async function assertAndroidArtifactBudgets(outputs) {
  for (const output of outputs) {
    const artifactPaths = await resolveAndroidArtifactPaths(output)

    if (artifactPaths.length === 0) {
      throw new Error(
        `Android artifact was not found for budget check: ${path.relative(repoRoot, output.path)}`,
      )
    }

    for (const artifactPath of artifactPaths) {
      const artifactStats = await stat(artifactPath)

      if (artifactStats.size > output.maxBytes) {
        throw new Error(
          [
            `${output.label} is ${formatMegabytes(artifactStats.size)}.`,
            `Budget is ${formatMegabytes(output.maxBytes)}.`,
            `Artifact: ${path.relative(repoRoot, artifactPath)}.`,
          ].join(' '),
        )
      }

      console.log(
        `[mobile-release] ${output.label} size: ${formatMegabytes(
          artifactStats.size,
        )} (budget ${formatMegabytes(output.maxBytes)})`,
      )
    }
  }
}

export async function resolveAndroidArtifactPaths(output) {
  const outputStats = await readOptionalStats(output.path)

  if (!outputStats) {
    return []
  }

  if (outputStats.isFile()) {
    return [output.path]
  }

  if (!outputStats.isDirectory()) {
    return []
  }

  const entries = await readdir(output.path, { withFileTypes: true })
  const extension = output.extension ?? ''

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(output.path, entry.name))
    .sort()
}

export async function readOptionalStats(filePath) {
  try {
    return await stat(filePath)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null
    }

    throw error
  }
}

export function readMegabyteBudget(variableName, defaultMegabytes) {
  const rawValue = process.env[variableName]?.trim()

  if (!rawValue) {
    return defaultMegabytes * 1024 * 1024
  }

  const megabytes = Number(rawValue)

  if (!Number.isFinite(megabytes) || megabytes <= 0) {
    throw new Error(
      `${variableName} must be a positive number of megabytes: ${rawValue}`,
    )
  }

  return megabytes * 1024 * 1024
}

export function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
