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
