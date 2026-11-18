const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/

export function createReleaseLayout(remoteRoot, commit) {
  const normalizedRoot = normalizeRemoteRoot(remoteRoot)
  const normalizedCommit = String(commit).trim().toLowerCase()

  if (!FULL_COMMIT_PATTERN.test(normalizedCommit)) {
    throw new Error(`Unexpected deploy commit: ${commit}`)
  }

  const releasesRoot = `${normalizedRoot}/releases`
  const sharedRoot = `${normalizedRoot}/shared`

  return {
    backupsDirectory: `${sharedRoot}/backups`,
    currentLink: `${normalizedRoot}/current`,
    lockFile: `${normalizedRoot}/.deploy.lock`,
    releaseDirectory: `${releasesRoot}/${normalizedCommit}`,
    releaseId: normalizedCommit,
    releasesRoot,
    remoteRoot: normalizedRoot,
    sharedRoot,
    stateDirectory: `${sharedRoot}/state`,
  }
}

export function parseReleaseRetention(value) {
  const retention = Number(value)

  if (!Number.isSafeInteger(retention) || retention < 2 || retention > 20) {
    throw new Error('DEPLOY_RELEASE_RETENTION must be an integer from 2 to 20.')
  }

  return retention
}

function normalizeRemoteRoot(remoteRoot) {
  const value = String(remoteRoot).trim().replace(/\/+$/, '')

  if (!value.startsWith('/') || value === '' || value === '/') {
    throw new Error(
      `DEPLOY_REMOTE_ROOT must be an absolute non-root path: ${remoteRoot}`,
    )
  }

  if (value.includes('\n') || value.includes('\r')) {
    throw new Error('DEPLOY_REMOTE_ROOT must not contain line breaks.')
  }

  return value
}

export function assertDeployCommitOnMainline({
  allowNonMainline,
  branch,
  headIsOnMainline,
  mainline,
}) {
  if (headIsOnMainline) {
    return { onMainline: true, warnings: [] }
  }

  if (!allowNonMainline) {
    throw new Error(
      [
        `[deploy] Refusing to deploy ${branch}: HEAD is not contained in ${mainline}.`,
        '[deploy] Production must run code that is already merged.',
        `[deploy] Merge the pull request, then run: git switch main && git pull --ff-only && npm run deploy:prod`,
        '[deploy] Emergency only: pass --allow-non-main (or DEPLOY_ALLOW_NON_MAIN=1).',
      ].join('\n'),
    )
  }

  return {
    onMainline: false,
    warnings: [
      `[deploy] WARNING: deploying ${branch}, which is not contained in ${mainline}.`,
      `[deploy] WARNING: merge it into ${mainline} soon, or production will drift from main.`,
    ],
  }
}

export function createDeployTagName(deployedAt) {
  if (!(deployedAt instanceof Date) || Number.isNaN(deployedAt.getTime())) {
    throw new Error(`Unexpected deploy time: ${deployedAt}`)
  }

  const iso = deployedAt.toISOString()

  return `deploy/${iso.slice(0, 10).replaceAll('-', '')}-${iso
    .slice(11, 19)
    .replaceAll(':', '')}`
}

export function parseAndroidVersion(gradleSource) {
  const versionName = /^\s*versionName\s+"([^"]+)"/m.exec(gradleSource)?.[1]
  const versionCode = /^\s*versionCode\s+(\d+)/m.exec(gradleSource)?.[1]

  return {
    versionCode: versionCode ?? null,
    versionName: versionName ?? null,
  }
}

export function createDeployTagMessage({
  branch,
  commit,
  domain,
  onMainline,
  version,
}) {
  const versionLine =
    version.versionName === null
      ? 'version: unknown'
      : `version: ${version.versionName}${
          version.versionCode === null ? '' : ` (build ${version.versionCode})`
        }`

  return [
    `Production deploy to ${domain}`,
    '',
    versionLine,
    `commit: ${commit}`,
    `branch: ${branch}${onMainline ? '' : ' (NOT merged into main)'}`,
    '',
  ].join('\n')
}
