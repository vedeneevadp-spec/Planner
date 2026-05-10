import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const capacitorConfig = await readFile('capacitor.config.ts', 'utf8')
const androidBuildGradle = await readFile('android/app/build.gradle', 'utf8')
const iosProject = await readFile(
  'ios/App/App.xcodeproj/project.pbxproj',
  'utf8',
)
const manifest = JSON.parse(
  await readFile('apps/web/public/manifest.webmanifest', 'utf8'),
)

const appId = readSingleMatch(capacitorConfig, /appId:\s*'([^']+)'/, 'appId')
const appName = readSingleMatch(
  capacitorConfig,
  /appName:\s*'([^']+)'/,
  'appName',
)
const webDir = readSingleMatch(capacitorConfig, /webDir:\s*'([^']+)'/, 'webDir')
const androidApplicationId = readSingleMatch(
  androidBuildGradle,
  /applicationId\s+"([^"]+)"/,
  'Android applicationId',
)
const androidVersionCode = Number(
  readSingleMatch(
    androidBuildGradle,
    /versionCode\s+(\d+)/,
    'Android versionCode',
  ),
)
const androidVersionName = readSingleMatch(
  androidBuildGradle,
  /versionName\s+"([^"]+)"/,
  'Android versionName',
)
const iosBundleIds = readUniqueMatches(
  iosProject,
  /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g,
)
const iosBuildNumbers = readUniqueMatches(
  iosProject,
  /CURRENT_PROJECT_VERSION = ([^;]+);/g,
)
const iosMarketingVersions = readUniqueMatches(
  iosProject,
  /MARKETING_VERSION = ([^;]+);/g,
)

assert.equal(appId, 'ru.chaotika.app')
assert.equal(androidApplicationId, appId)
assert.deepEqual(iosBundleIds, [appId])
assert.equal(appName, manifest.name)
assert.equal(webDir, 'apps/web/dist')
assert.ok(Number.isInteger(androidVersionCode) && androidVersionCode > 0)
assert.deepEqual(iosBuildNumbers, [String(androidVersionCode)])
assert.deepEqual(iosMarketingVersions, [androidVersionName])
assert.equal(manifest.display, 'standalone')
assert.equal(manifest.start_url, '/today')
assert.ok(
  manifest.icons.some((icon) => icon.purpose === 'maskable'),
  'PWA manifest must include a maskable icon.',
)

console.log('Mobile CI check passed.')

function readSingleMatch(content, pattern, label) {
  const match = content.match(pattern)

  assert.ok(match?.[1], `Missing ${label}.`)

  return match[1].trim()
}

function readUniqueMatches(content, pattern) {
  return [
    ...new Set([...content.matchAll(pattern)].map((match) => match[1].trim())),
  ].sort()
}
