import {
  parseArgs,
  ensureUrl,
  printHelp,
  parseBuildNumber,
} from './mobile-release-options.mjs'
import {
  assertAndroidArtifactBudgets,
  readMegabyteBudget,
} from './mobile-release-artifacts.mjs'
import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {
  replaceAndroidVersion,
  replaceIosVersion,
  replacePackageLockVersion,
  replacePackageVersion,
} from './app-version.mjs'
import { assertAndroidFirebaseConfig } from './mobile-release-android-config.mjs'
import { assertGooglePlayArtifact } from './google-play-artifact.mjs'
import { resolveMobileWebBuildEnv } from './mobile-web-build-env.mjs'

const repoRoot = process.cwd()
const androidBuildGradlePath = path.join(repoRoot, 'android/app/build.gradle')
const packageJsonPath = path.join(repoRoot, 'package.json')
const packageLockPath = path.join(repoRoot, 'package-lock.json')
const androidDirectoryPath = path.join(repoRoot, 'android')
const androidReleaseApkDirectoryPath = path.join(
  repoRoot,
  'android/app/build/outputs/apk/release',
)
const androidReleaseApkPath = path.join(
  androidReleaseApkDirectoryPath,
  'app-release.apk',
)
const androidReleaseBundlePath = path.join(
  repoRoot,
  'android/app/build/outputs/bundle/release/app-release.aab',
)
const androidKeystorePropertiesExamplePath = path.join(
  repoRoot,
  'android/keystore.properties.example',
)
const androidKeystorePropertiesPath = path.join(
  repoRoot,
  'android/keystore.properties',
)
const androidFirebaseConfigPath = path.join(
  repoRoot,
  'android/app/google-services.json',
)
const androidApplicationId = 'ru.chaotika.app'
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

  if (!options.dryRun && ['android', 'all'].includes(options.buildArtifacts)) {
    await assertAndroidFirebaseConfig({
      applicationId: androidApplicationId,
      filePath: androidFirebaseConfigPath,
    })
    console.log('[mobile-release] Android Firebase config is valid.')
  }

  await assertReleaseApiHealth(apiUrl, {
    dryRun: options.dryRun,
    skip: options.skipApiHealthCheck,
  })

  const mobileWebBuild = await resolveMobileWebBuildEnv({
    apiUrl,
    repoRoot,
  })
  const authMode =
    mobileWebBuild.env.VITE_AUTH_PROVIDER === 'planner'
      ? 'planner'
      : 'legacy overrides'

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
      `  androidChannel: ${options.androidChannel}`,
      `  androidAbi:     ${options.androidAbiFilters ?? '(all)'}`,
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

  await runCommand(
    'npm',
    [
      'run',
      'mobile:sync',
      ...(options.buildArtifacts === 'android' ? ['--', 'android'] : []),
    ],
    {
      dryRun: options.dryRun,
      env: {
        ...mobileWebBuild.env,
        VITE_ANDROID_DISTRIBUTION: options.androidChannel,
      },
    },
  )

  await buildArtifacts({
    androidAbiFilters: options.androidAbiFilters,
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
  androidAbiFilters,
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
      androidAbiFilters,
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
  androidAbiFilters,
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

  const gradleArgs = [
    ...tasks,
    `-PdistributionChannel=${options.androidChannel}`,
  ]

  if (androidAbiFilters) {
    gradleArgs.push(`-PandroidAbiFilters=${androidAbiFilters}`)
  }

  await runCommand(gradleCommand, gradleArgs, {
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
    outputs.push({
      label: 'Android release AAB',
      maxBytes: readMegabyteBudget('ANDROID_RELEASE_AAB_MAX_MB', 95),
      path: androidReleaseBundlePath,
    })
  }

  if (androidFormat === 'apk' || androidFormat === 'both') {
    outputs.push(
      requireAndroidSigning
        ? {
            label: 'Android release APK',
            maxBytes: readMegabyteBudget('ANDROID_RELEASE_APK_MAX_MB', 80),
            path: androidReleaseApkPath,
          }
        : {
            extension: '.apk',
            label: 'Android release APK',
            maxBytes: readMegabyteBudget('ANDROID_RELEASE_APK_MAX_MB', 80),
            path: androidReleaseApkDirectoryPath,
          },
    )
  }

  await assertAndroidArtifactBudgets(outputs)

  if (options.androidChannel === 'googlePlay') {
    await assertGooglePlayArtifact(androidReleaseBundlePath)
    console.log(
      '[mobile-release] Google Play AAB has no external APK updater or install permission.',
    )
  }

  console.log(
    `[mobile-release] Android artifacts: ${outputs
      .map((output) => path.relative(repoRoot, output.path))
      .join(', ')}`,
  )
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
  const packageJson = await readFile(packageJsonPath, 'utf8')
  const packageLock = await readFile(packageLockPath, 'utf8')

  const nextAndroidBuildGradle = replaceAndroidVersion(androidBuildGradle, {
    buildNumber,
    version,
  })
  const nextIosProject = replaceIosVersion(iosProject, {
    buildNumber,
    version,
  })
  // package.json "version" is the source of truth checked by npm run version:check.
  const nextPackageJson = version
    ? replacePackageVersion(packageJson, version)
    : packageJson
  const nextPackageLock = version
    ? replacePackageLockVersion(packageLock, version)
    : packageLock

  if (dryRun) {
    console.log(
      '[mobile-release] Dry run: package.json, package-lock.json, android/app/build.gradle and ios/App/App.xcodeproj/project.pbxproj were not updated.',
    )
    return
  }

  await writeFile(androidBuildGradlePath, nextAndroidBuildGradle)
  await writeFile(iosProjectPath, nextIosProject)
  await writeFile(packageJsonPath, nextPackageJson)
  await writeFile(packageLockPath, nextPackageLock)
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
  const isGooglePlay = options.androidChannel === 'googlePlay'
  const propertiesPath = isGooglePlay
    ? path.join(
        androidDirectoryPath,
        'keystore/google-play-upload/keystore.properties',
      )
    : androidKeystorePropertiesPath
  const envPrefix = isGooglePlay ? 'GOOGLE_PLAY_UPLOAD' : 'ANDROID'
  const properties = await readSimplePropertiesFile(propertiesPath)
  const storeFileValue =
    readFirstDefined(
      properties.storeFile,
      process.env[`${envPrefix}_KEYSTORE_PATH`],
    ) ?? undefined
  const storePassword =
    readFirstDefined(
      properties.storePassword,
      process.env[`${envPrefix}_KEYSTORE_PASSWORD`],
    ) ?? undefined
  const keyAlias =
    readFirstDefined(
      properties.keyAlias,
      process.env[`${envPrefix}_KEY_ALIAS`],
    ) ?? undefined
  const keyPassword =
    readFirstDefined(
      properties.keyPassword,
      process.env[`${envPrefix}_KEY_PASSWORD`],
    ) ?? undefined

  return {
    envPrefix,
    propertiesPath,
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
    missingFields.push(`storeFile / ${config.envPrefix}_KEYSTORE_PATH`)
  }

  if (!config.storePassword) {
    missingFields.push(`storePassword / ${config.envPrefix}_KEYSTORE_PASSWORD`)
  }

  if (!config.keyAlias) {
    missingFields.push(`keyAlias / ${config.envPrefix}_KEY_ALIAS`)
  }

  if (!config.keyPassword) {
    missingFields.push(`keyPassword / ${config.envPrefix}_KEY_PASSWORD`)
  }

  if (missingFields.length > 0) {
    throw new Error(
      [
        'Android release signing is not configured.',
        `Missing: ${missingFields.join(', ')}.`,
        `Create ${config.propertiesPath} from ${androidKeystorePropertiesExamplePath} or provide the matching env vars.`,
      ].join(' '),
    )
  }

  if (!(await pathExists(config.storeFile))) {
    throw new Error(
      `Android keystore file was not found: ${config.storeFile}. Update ${config.propertiesPath} or ${config.envPrefix}_KEYSTORE_PATH.`,
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
