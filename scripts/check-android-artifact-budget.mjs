import { stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const artifacts = [
  {
    defaultMaxMb: 180,
    label: 'Android debug APK',
    path: 'android/app/build/outputs/apk/debug/app-debug.apk',
    variable: 'ANDROID_DEBUG_APK_MAX_MB',
  },
  {
    defaultMaxMb: 80,
    label: 'Android release APK',
    path: 'android/app/build/outputs/apk/release/app-release.apk',
    variable: 'ANDROID_RELEASE_APK_MAX_MB',
  },
  {
    defaultMaxMb: 95,
    label: 'Android release AAB',
    path: 'android/app/build/outputs/bundle/release/app-release.aab',
    variable: 'ANDROID_RELEASE_AAB_MAX_MB',
  },
]

const checkedArtifacts = []

for (const artifact of artifacts) {
  const artifactPath = path.join(repoRoot, artifact.path)
  const artifactStats = await readOptionalStats(artifactPath)

  if (!artifactStats?.isFile()) {
    continue
  }

  const maxBytes = readMegabyteBudget(artifact.variable, artifact.defaultMaxMb)

  if (artifactStats.size > maxBytes) {
    throw new Error(
      [
        `${artifact.label} is ${formatMegabytes(artifactStats.size)}.`,
        `Budget is ${formatMegabytes(maxBytes)} (${artifact.variable}).`,
        `Artifact: ${artifact.path}.`,
      ].join(' '),
    )
  }

  checkedArtifacts.push(
    `${artifact.label}: ${formatMegabytes(artifactStats.size)} / ${formatMegabytes(
      maxBytes,
    )}`,
  )
}

if (checkedArtifacts.length === 0) {
  throw new Error(
    'No Android APK/AAB artifacts were found. Run mobile:android:assemble or mobile:release first.',
  )
}

console.log(
  `Android artifact budget check passed. ${checkedArtifacts.join('. ')}.`,
)

async function readOptionalStats(filePath) {
  try {
    return await stat(filePath)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'ENOENT') {
        return null
      }
    }

    throw error
  }
}

function readMegabyteBudget(variableName, defaultMegabytes) {
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

function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
