import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { resolveMobileWebBuildEnv } from './mobile-web-build-env.mjs'

const repoRoot = process.cwd()
const androidBuildGradlePath = path.join(repoRoot, 'android/app/build.gradle')
const androidDirectoryPath = path.join(repoRoot, 'android')
const androidKeystorePropertiesExamplePath = path.join(
  repoRoot,
  'android/keystore.properties.example',
)
const androidKeystorePropertiesPath = path.join(
  repoRoot,
  'android/keystore.properties',
)
const androidLocalPropertiesPath = path.join(
  repoRoot,
  'android/local.properties',
)
const iosArchivePath = path.join(repoRoot, 'ios/build/Chaotika.xcarchive')
const iosExportPath = path.join(repoRoot, 'ios/build/export')
const iosProjectPath = path.join(
  repoRoot,
  'ios/App/App.xcodeproj/project.pbxproj',
)
const iosXcodeProjectArgument = 'ios/App/App.xcodeproj'
const DEFAULT_API_URL = 'https://chaotika.ru'

const options = parseArgs(process.argv.slice(2))

if (options.help) {
  printHelp()
  process.exit(0)
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

async function main() {
  const apiUrl =
    options.apiUrl ??
    process.env.MOBILE_API_URL ??
    process.env.VITE_API_BASE_URL ??
    DEFAULT_API_URL

  ensureUrl(apiUrl)

  await assertReleaseApiHealth(apiUrl, {
    dryRun: options.dryRun,
    skip: options.skipApiHealthCheck,
  })

  const mobileWebBuild = await resolveMobileWebBuildEnv({
    apiUrl,
    repoRoot,
  })
  const authMode = mobileWebBuild.env.VITE_AUTH_PROVIDER ?? 'legacy overrides'

  const version = options.version ?? process.env.MOBILE_VERSION ?? undefined
  const buildNumberInput =
    options.build ?? process.env.MOBILE_BUILD_NUMBER ?? undefined
  const buildNumber =
    buildNumberInput === undefined
      ? undefined
      : parseBuildNumber(buildNumberInput)

  console.log(
    [
      '[mobile-release] Preparing native release',
      `  apiUrl:         ${apiUrl}`,
      `  version:        ${version ?? '(keep current)'}`,
      `  build:          ${buildNumber ?? '(keep current)'}`,
      `  assets:         ${options.assets ? 'yes' : 'no'}`,
      `  buildArtifacts: ${options.buildArtifacts}`,
      `  androidFormat:  ${options.androidFormat}`,
      `  authMode:       ${authMode}`,
      `  requireSigning: ${options.requireAndroidSigning ? 'yes' : 'no'}`,
      `  open:           ${options.open ?? 'none'}`,
      `  dryRun:         ${options.dryRun ? 'yes' : 'no'}`,
    ].join('\n'),
  )

  if (mobileWebBuild.loadedEnvFile) {
    console.log(
      `[mobile-release] Loaded auth config from ${path.relative(repoRoot, mobileWebBuild.loadedEnvFile)}`,
    )
  }

  if (version || buildNumber !== undefined) {
    await updateNativeVersions({
      buildNumber,
      dryRun: options.dryRun,
      version,
    })
  }

  if (options.assets) {
    await runCommand('npm', ['run', 'mobile:assets'], {
      dryRun: options.dryRun,
    })
  }

  await runCommand('npm', ['run', 'mobile:sync'], {
    dryRun: options.dryRun,
    env: mobileWebBuild.env,
  })

  await buildArtifacts({
    androidFormat: options.androidFormat,
    androidJavaHome:
      options.androidJavaHome ??
      process.env.MOBILE_ANDROID_JAVA_HOME ??
      undefined,
    androidSdkPath:
      options.androidSdkPath ?? process.env.MOBILE_ANDROID_SDK ?? undefined,
    buildArtifacts: options.buildArtifacts,
    dryRun: options.dryRun,
    iosDeveloperDir:
      options.iosDeveloperDir ??
      process.env.MOBILE_IOS_DEVELOPER_DIR ??
      undefined,
    iosExportOptionsPath:
      options.iosExportOptionsPath ??
      process.env.MOBILE_IOS_EXPORT_OPTIONS ??
      undefined,
  })

  if (options.open && options.open !== 'none') {
    const platforms =
      options.open === 'all' ? ['ios', 'android'] : [options.open]

    for (const platform of platforms) {
      await runCommand('npx', ['cap', 'open', platform], {
        dryRun: options.dryRun,
      })
    }
  }
}

async function buildArtifacts({
  buildArtifacts,
  androidFormat,
  androidJavaHome,
  androidSdkPath,
  dryRun,
  iosDeveloperDir,
  iosExportOptionsPath,
}) {
  if (buildArtifacts === 'none') {
    return
  }

  if (buildArtifacts === 'android' || buildArtifacts === 'all') {
    await buildAndroidArtifacts({
      androidFormat,
      androidJavaHome,
      requireAndroidSigning: options.requireAndroidSigning,
      androidSdkPath,
      dryRun,
    })
  }

  if (buildArtifacts === 'ios' || buildArtifacts === 'all') {
    await buildIosArtifacts({
      developerDirOverride: iosDeveloperDir,
      dryRun,
      exportOptionsPath: iosExportOptionsPath,
    })
  }
}

async function buildAndroidArtifacts({
  androidFormat,
  androidJavaHome,
  requireAndroidSigning,
  androidSdkPath,
  dryRun,
}) {
  const resolvedSdkPath = await resolveAndroidSdkPath(androidSdkPath)
  const resolvedJavaHome = await resolveAndroidJavaHome(androidJavaHome)
  const signingConfig = await resolveAndroidSigningConfig()

  if (!resolvedSdkPath) {
    if (dryRun) {
      console.log(
        '[mobile-release] Dry run: Android SDK was not found. Set ANDROID_HOME, ANDROID_SDK_ROOT, MOBILE_ANDROID_SDK, or install the SDK in ~/Library/Android/sdk.',
      )
      return
    }

    throw new Error(
      [
        'Android SDK not found.',
        'Set ANDROID_HOME, ANDROID_SDK_ROOT, MOBILE_ANDROID_SDK,',
        'or install the SDK in ~/Library/Android/sdk.',
      ].join(' '),
    )
  }

  if (!resolvedJavaHome) {
    if (dryRun) {
      console.log(
        '[mobile-release] Dry run: Java 21 for Android build was not found. Use Android Studio JBR or pass --android-java-home=...',
      )
      return
    }

    throw new Error(
      [
        'Java 21 for Android build was not found.',
        'Pass --android-java-home=..., set MOBILE_ANDROID_JAVA_HOME,',
        'or use /Applications/Android Studio.app/Contents/jbr/Contents/Home.',
      ].join(' '),
    )
  }

  if (requireAndroidSigning) {
    await ensureAndroidSigningConfig(signingConfig)
  }

  await ensureAndroidLocalProperties(resolvedSdkPath, { dryRun })

  const gradleCommand =
    process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
  const tasks = []

  if (androidFormat === 'bundle' || androidFormat === 'both') {
    tasks.push(':app:bundleRelease')
  }

  if (androidFormat === 'apk' || androidFormat === 'both') {
    tasks.push(':app:assembleRelease')
  }

  await runCommand(gradleCommand, tasks, {
    cwd: androidDirectoryPath,
    dryRun,
    env: {
      ...process.env,
      JAVA_HOME: resolvedJavaHome,
    },
  })

  if (dryRun) {
    return
  }

  const outputs = []

  if (androidFormat === 'bundle' || androidFormat === 'both') {
    outputs.push('android/app/build/outputs/bundle/release/app-release.aab')
  }

  if (androidFormat === 'apk' || androidFormat === 'both') {
    outputs.push(
      requireAndroidSigning
        ? 'android/app/build/outputs/apk/release/app-release.apk'
        : 'android/app/build/outputs/apk/release/',
    )
  }

  console.log(`[mobile-release] Android artifacts: ${outputs.join(', ')}`)
}

async function buildIosArtifacts({
  developerDirOverride,
  dryRun,
  exportOptionsPath,
}) {
  const developerDir = await resolveIosDeveloperDir(developerDirOverride)

  if (!developerDir) {
    if (dryRun) {
      console.log(
        '[mobile-release] Dry run: full Xcode developer directory was not found. Pass --ios-developer-dir or install Xcode.',
      )
      return
    }

    throw new Error(
      [
        'Full Xcode developer directory was not found.',
        'Install Xcode from the App Store or pass --ios-developer-dir=/Applications/Xcode.app/Contents/Developer.',
      ].join(' '),
    )
  }

  const xcodeEnv = {
    ...process.env,
    DEVELOPER_DIR: developerDir,
  }

  if (!dryRun) {
    await ensureXcodeIsReady(xcodeEnv)
    await mkdir(path.dirname(iosArchivePath), { recursive: true })
  }

  await runCommand(
    'xcodebuild',
    [
      '-project',
      iosXcodeProjectArgument,
      '-scheme',
      'App',
      '-configuration',
      'Release',
      '-destination',
      'generic/platform=iOS',
      '-archivePath',
      iosArchivePath,
      'archive',
    ],
    {
      dryRun,
      env: xcodeEnv,
    },
  )

  if (exportOptionsPath) {
    const resolvedExportOptionsPath = path.resolve(repoRoot, exportOptionsPath)

    if (!(await pathExists(resolvedExportOptionsPath))) {
      throw new Error(
        `iOS export options plist was not found: ${resolvedExportOptionsPath}`,
      )
    }

    if (!dryRun) {
      await mkdir(iosExportPath, { recursive: true })
    }

    await runCommand(
      'xcodebuild',
      [
        '-exportArchive',
        '-archivePath',
        iosArchivePath,
        '-exportOptionsPlist',
        resolvedExportOptionsPath,
        '-exportPath',
        iosExportPath,
      ],
      {
        dryRun,
        env: xcodeEnv,
      },
    )
  }

  if (dryRun) {
    return
  }

  console.log(
    `[mobile-release] iOS archive: ${iosArchivePath}${exportOptionsPath ? `; export: ${iosExportPath}` : ''}`,
  )
}

async function ensureXcodeIsReady(env) {
  const result = await collectCommand(
    'xcodebuild',
    ['-list', '-project', iosXcodeProjectArgument],
    {
      env,
    },
  )

  if (result.code === 0) {
    return
  }

  const output = `${result.stdout}\n${result.stderr}`

  if (output.includes('runFirstLaunch')) {
    throw new Error(
      [
        'Xcode is installed but not initialized.',
        "Run 'sudo xcodebuild -runFirstLaunch' once, then retry.",
      ].join(' '),
    )
  }

  if (output.includes('requires Xcode')) {
    throw new Error(
      [
        'xcodebuild is pointing to CommandLineTools instead of full Xcode.',
        "Run 'sudo xcode-select -s /Applications/Xcode.app/Contents/Developer' or pass --ios-developer-dir.",
      ].join(' '),
    )
  }

  throw new Error(
    `Unable to prepare Xcode build environment.\n${output.trim()}`,
  )
}

async function ensureAndroidLocalProperties(sdkPath, { dryRun }) {
  const escapedSdkPath = sdkPath.replace(/\\/g, '\\\\')
  let currentContents = ''

  if (await pathExists(androidLocalPropertiesPath)) {
    currentContents = await readFile(androidLocalPropertiesPath, 'utf8')
  }

  const nextContents = upsertProperty(
    currentContents,
    'sdk.dir',
    escapedSdkPath,
  )

  if (nextContents === currentContents) {
    return
  }

  if (dryRun) {
    console.log(
      `[mobile-release] Dry run: would update android/local.properties with sdk.dir=${escapedSdkPath}`,
    )
    return
  }

  await writeFile(androidLocalPropertiesPath, nextContents)
}

function upsertProperty(content, key, value) {
  const normalizedContent =
    content.length === 0
      ? ''
      : content.endsWith('\n')
        ? content
        : `${content}\n`
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm')

  if (pattern.test(normalizedContent)) {
    return normalizedContent.replace(pattern, `${key}=${value}`)
  }

  return `${normalizedContent}${key}=${value}\n`
}

async function updateNativeVersions({ version, buildNumber, dryRun }) {
  const androidBuildGradle = await readFile(androidBuildGradlePath, 'utf8')
  const iosProject = await readFile(iosProjectPath, 'utf8')

  const nextAndroidBuildGradle = replaceAndroidVersion(androidBuildGradle, {
    buildNumber,
    version,
  })
  const nextIosProject = replaceIosVersion(iosProject, {
    buildNumber,
    version,
  })

  if (dryRun) {
    console.log(
      '[mobile-release] Dry run: android/app/build.gradle and ios/App/App.xcodeproj/project.pbxproj were not updated.',
    )
    return
  }

  await writeFile(androidBuildGradlePath, nextAndroidBuildGradle)
  await writeFile(iosProjectPath, nextIosProject)
}

function replaceAndroidVersion(content, { version, buildNumber }) {
  let result = content

  if (buildNumber !== undefined) {
    const pattern = /^(\s*versionCode\s+)\d+$/m
    if (!pattern.test(result)) {
      throw new Error('Could not find versionCode in android/app/build.gradle.')
    }

    result = result.replace(pattern, `$1${buildNumber}`)
  }

  if (version) {
    const pattern = /^(\s*versionName\s+)"[^"]+"$/m
    if (!pattern.test(result)) {
      throw new Error('Could not find versionName in android/app/build.gradle.')
    }

    result = result.replace(pattern, `$1"${version}"`)
  }

  return result
}

function replaceIosVersion(content, { version, buildNumber }) {
  let result = content

  if (buildNumber !== undefined) {
    const matches = result.match(/CURRENT_PROJECT_VERSION = \d+;/g)
    if (!matches || matches.length < 2) {
      throw new Error(
        'Could not find CURRENT_PROJECT_VERSION entries in iOS project file.',
      )
    }

    result = result.replace(
      /CURRENT_PROJECT_VERSION = \d+;/g,
      `CURRENT_PROJECT_VERSION = ${buildNumber};`,
    )
  }

  if (version) {
    const matches = result.match(/MARKETING_VERSION = [^;]+;/g)
    if (!matches || matches.length < 2) {
      throw new Error(
        'Could not find MARKETING_VERSION entries in iOS project file.',
      )
    }

    result = result.replace(
      /MARKETING_VERSION = [^;]+;/g,
      `MARKETING_VERSION = ${version};`,
    )
  }

  return result
}

function parseArgs(args) {
  const options = {
    androidFormat: process.env.MOBILE_ANDROID_FORMAT ?? 'bundle',
    androidJavaHome: undefined,
    androidSdkPath: undefined,
    apiUrl: undefined,
    assets: false,
    build: undefined,
    buildArtifacts: process.env.MOBILE_BUILD_ARTIFACTS ?? 'none',
    dryRun: false,
    help: false,
    iosDeveloperDir: undefined,
    iosExportOptionsPath: undefined,
    open: undefined,
    requireAndroidSigning: false,
    skipApiHealthCheck: process.env.MOBILE_SKIP_API_HEALTH_CHECK === 'true',
    version: undefined,
  }

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (arg === '--assets') {
      options.assets = true
      continue
    }

    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (arg === '--require-android-signing') {
      options.requireAndroidSigning = true
      continue
    }

    if (arg === '--skip-api-health-check') {
      options.skipApiHealthCheck = true
      continue
    }

    if (arg.startsWith('--api-url=')) {
      options.apiUrl = arg.slice('--api-url='.length)
      continue
    }

    if (arg.startsWith('--version=')) {
      options.version = arg.slice('--version='.length)
      continue
    }

    if (arg.startsWith('--build=')) {
      options.build = arg.slice('--build='.length)
      continue
    }

    if (arg.startsWith('--build-artifacts=')) {
      const value = arg.slice('--build-artifacts='.length)

      if (!['none', 'android', 'ios', 'all'].includes(value)) {
        throw new Error(
          'Invalid --build-artifacts value. Use none, android, ios, or all.',
        )
      }

      options.buildArtifacts = value
      continue
    }

    if (arg.startsWith('--android-format=')) {
      const value = arg.slice('--android-format='.length)

      if (!['apk', 'bundle', 'both'].includes(value)) {
        throw new Error(
          'Invalid --android-format value. Use apk, bundle, or both.',
        )
      }

      options.androidFormat = value
      continue
    }

    if (arg.startsWith('--android-sdk=')) {
      options.androidSdkPath = arg.slice('--android-sdk='.length)
      continue
    }

    if (arg.startsWith('--android-java-home=')) {
      options.androidJavaHome = arg.slice('--android-java-home='.length)
      continue
    }

    if (arg.startsWith('--ios-developer-dir=')) {
      options.iosDeveloperDir = arg.slice('--ios-developer-dir='.length)
      continue
    }

    if (arg.startsWith('--ios-export-options=')) {
      options.iosExportOptionsPath = arg.slice('--ios-export-options='.length)
      continue
    }

    if (arg.startsWith('--open=')) {
      const open = arg.slice('--open='.length)

      if (!['ios', 'android', 'all', 'none'].includes(open)) {
        throw new Error('Invalid --open value. Use ios, android, all, or none.')
      }

      options.open = open
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function ensureUrl(value) {
  let url

  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid API URL: ${value}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`API URL must use http or https: ${value}`)
  }
}

async function assertReleaseApiHealth(apiUrl, { dryRun, skip }) {
  const healthUrl = new URL('/api/health', apiUrl)

  if (skip) {
    console.log(
      `[mobile-release] Skipping API health check: ${healthUrl.toString()}`,
    )
    return
  }

  if (dryRun) {
    console.log(
      `[mobile-release] Dry run: would check API health at ${healthUrl.toString()}`,
    )
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  let response

  try {
    response = await fetch(healthUrl, {
      headers: {
        accept: 'application/json',
      },
      signal: controller.signal,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'unknown network error'

    throw new Error(
      `API health check failed for ${healthUrl.toString()}: ${message}`,
    )
  } finally {
    clearTimeout(timeout)
  }

  let payload

  try {
    payload = (await response.json()) ?? null
  } catch {
    payload = null
  }

  if (!response.ok || !isHealthyApiPayload(payload)) {
    throw new Error(
      [
        `API health check failed for ${healthUrl.toString()}.`,
        `HTTP ${response.status}.`,
        `Response: ${JSON.stringify(payload)}`,
      ].join(' '),
    )
  }

  console.log(
    `[mobile-release] API is healthy: ${healthUrl.toString()} (${payload.databaseStatus})`,
  )
}

function isHealthyApiPayload(payload) {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    payload.status === 'ok' &&
    payload.databaseStatus !== 'down'
  )
}

function parseBuildNumber(value) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Build number must be a positive integer: ${value}`)
  }

  return Number(value)
}

async function resolveAndroidSdkPath(preferredPath) {
  const candidates = [
    preferredPath,
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), 'Library/Android/sdk'),
    path.join(os.homedir(), 'Android/Sdk'),
  ].filter(Boolean)

  for (const candidate of candidates) {
    const resolvedCandidate = path.resolve(repoRoot, candidate)
    if (await pathExists(resolvedCandidate)) {
      return resolvedCandidate
    }
  }

  return undefined
}

async function resolveAndroidSigningConfig() {
  const properties = await readSimplePropertiesFile(
    androidKeystorePropertiesPath,
  )
  const storeFileValue =
    readFirstDefined(properties.storeFile, process.env.ANDROID_KEYSTORE_PATH) ??
    undefined
  const storePassword =
    readFirstDefined(
      properties.storePassword,
      process.env.ANDROID_KEYSTORE_PASSWORD,
    ) ?? undefined
  const keyAlias =
    readFirstDefined(properties.keyAlias, process.env.ANDROID_KEY_ALIAS) ??
    undefined
  const keyPassword =
    readFirstDefined(
      properties.keyPassword,
      process.env.ANDROID_KEY_PASSWORD,
    ) ?? undefined

  return {
    keyAlias,
    keyPassword,
    storeFile: storeFileValue
      ? path.isAbsolute(storeFileValue)
        ? storeFileValue
        : path.join(androidDirectoryPath, storeFileValue)
      : undefined,
    storePassword,
  }
}

async function resolveAndroidJavaHome(preferredPath) {
  const candidates = [
    preferredPath,
    process.env.JAVA_HOME,
    process.env.MOBILE_ANDROID_JAVA_HOME,
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    '/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home',
  ].filter(Boolean)

  for (const candidate of candidates) {
    const javaBinary = path.join(candidate, 'bin/java')

    if (!(await pathExists(javaBinary))) {
      continue
    }

    const result = await collectCommand(javaBinary, ['-version'])
    const output = `${result.stdout}\n${result.stderr}`

    if (result.code === 0 && /\b21\./.test(output)) {
      return candidate
    }
  }

  return undefined
}

async function ensureAndroidSigningConfig(config) {
  const missingFields = []

  if (!config.storeFile) {
    missingFields.push('storeFile / ANDROID_KEYSTORE_PATH')
  }

  if (!config.storePassword) {
    missingFields.push('storePassword / ANDROID_KEYSTORE_PASSWORD')
  }

  if (!config.keyAlias) {
    missingFields.push('keyAlias / ANDROID_KEY_ALIAS')
  }

  if (!config.keyPassword) {
    missingFields.push('keyPassword / ANDROID_KEY_PASSWORD')
  }

  if (missingFields.length > 0) {
    throw new Error(
      [
        'Android release signing is not configured.',
        `Missing: ${missingFields.join(', ')}.`,
        `Create ${androidKeystorePropertiesPath} from ${androidKeystorePropertiesExamplePath} or provide the matching env vars.`,
      ].join(' '),
    )
  }

  if (!(await pathExists(config.storeFile))) {
    throw new Error(
      `Android keystore file was not found: ${config.storeFile}. Update ${androidKeystorePropertiesPath} or ANDROID_KEYSTORE_PATH.`,
    )
  }
}

async function readSimplePropertiesFile(filePath) {
  if (!(await pathExists(filePath))) {
    return {}
  }

  const content = await readFile(filePath, 'utf8')
  const entries = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (line.length === 0 || line.startsWith('#') || line.startsWith('!')) {
      continue
    }

    const separatorIndex = line.search(/[:=]/)

    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()

    if (key.length > 0) {
      entries[key] = value
    }
  }

  return entries
}

function readFirstDefined(...values) {
  return values.find((value) => value != null && value !== '')
}

async function resolveIosDeveloperDir(preferredPath) {
  const candidates = [
    preferredPath,
    process.env.DEVELOPER_DIR,
    '/Applications/Xcode.app/Contents/Developer',
    '/Applications/Xcode-beta.app/Contents/Developer',
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  return undefined
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function printHelp() {
  console.log(`
Usage:
  npm run mobile:release -- --api-url=https://chaotika.ru --version=1.0.1 --build=2

Prep-only examples:
  npm run mobile:release -- --api-url=https://chaotika.ru --version=1.0.1 --build=2
  npm run mobile:release -- --assets --version=1.1.0 --build=7 --open=all

Build artifact examples:
  npm run mobile:release -- --api-url=https://chaotika.ru --version=1.0.1 --build=2 --build-artifacts=android --android-format=bundle
  npm run mobile:release -- --api-url=https://chaotika.ru --version=1.0.1 --build=2 --build-artifacts=all --android-format=both --ios-export-options=ios/ExportOptions.plist

Options:
  --api-url=<url>              API base URL embedded into the synced mobile web bundle.
  --version=<value>            Update Android versionName and iOS MARKETING_VERSION.
  --build=<number>             Update Android versionCode and iOS CURRENT_PROJECT_VERSION.
  --assets                     Regenerate native icons and splash assets before sync.
  --build-artifacts=<target>   Build none, android, ios, or all native artifacts after sync.
  --android-format=<format>    Build Android apk, bundle, or both. Default: bundle.
  --android-sdk=<path>         Override Android SDK path used for android/local.properties.
  --android-java-home=<path>   Override Java 21 home used for Android Gradle build.
  --require-android-signing    Fail if Android release signing is not configured.
  --skip-api-health-check      Skip GET /api/health before building.
  --ios-developer-dir=<path>   Override DEVELOPER_DIR for xcodebuild.
  --ios-export-options=<path>  Export IPA using the given ExportOptions.plist after archive.
  --open=<target>              Open ios, android, all, or none after sync/build.
  --dry-run                    Show actions without modifying files or running commands.
  --help, -h                   Show this help.
`)
}

function runCommand(command, args, options = {}) {
  const resolvedCommand =
    process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command
  const printable = [resolvedCommand, ...args].join(' ')

  if (options.dryRun) {
    console.log(`[mobile-release] Dry run: ${printable}`)
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const child = spawn(resolvedCommand, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: 'inherit',
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Command failed (${code}): ${printable}`))
    })
  })
}

function collectCommand(command, args, options = {}) {
  const resolvedCommand =
    process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command

  return new Promise((resolve, reject) => {
    const child = spawn(resolvedCommand, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      resolve({
        code: code ?? 1,
        stderr,
        stdout,
      })
    })
  })
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
