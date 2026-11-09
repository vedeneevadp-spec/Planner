import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function assertGooglePlayContents({ manifest, dex, entries }) {
  if (!manifest.includes('ru.chaotika.app')) {
    throw new Error('Google Play bundle has an unexpected package name.')
  }
  if (manifest.includes('REQUEST_INSTALL_PACKAGES')) {
    throw new Error(
      'Google Play bundle must not request installation of APK packages.',
    )
  }
  if (dex.includes('PlannerAppUpdate')) {
    throw new Error(
      'Google Play bundle must not contain the native APK updater.',
    )
  }
  if (
    entries.some((entry) =>
      /(?:NativeAppUpdates|native-app-updates)/.test(entry),
    )
  ) {
    throw new Error('Google Play bundle must not contain the web APK updater.')
  }
  if (!entries.includes('base/assets/public/index.html')) {
    throw new Error('Google Play bundle is missing the application web assets.')
  }
}

export async function assertGooglePlayArtifact(artifactPath) {
  const readZip = async (...args) => {
    const { stdout } = await execFileAsync('unzip', args, {
      maxBuffer: 64 * 1024 * 1024,
    })
    return stdout
  }
  const [manifest, dex, listing] = await Promise.all([
    readZip('-p', artifactPath, 'base/manifest/AndroidManifest.xml'),
    readZip('-p', artifactPath, 'base/dex/*.dex'),
    readZip('-Z1', artifactPath),
  ])
  assertGooglePlayContents({
    manifest,
    dex,
    entries: listing.trim().split('\n'),
  })
}
