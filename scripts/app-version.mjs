// Single source of the app version.
//
// Root package.json "version" is the source of truth for the user-facing
// version. Android versionName / iOS MARKETING_VERSION must equal it, Android
// versionCode / iOS CURRENT_PROJECT_VERSION must equal each other, and the
// newest "## vX.Y.Z" section of docs/release-notes.md must describe it.
//
//   npm run version:check                          verify all places agree
//   npm run version:set -- --version=1.2.3 --build=60   update all places
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const VERSION_FILES = {
  androidGradle: 'android/app/build.gradle',
  iosProject: 'ios/App/App.xcodeproj/project.pbxproj',
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  releaseNotes: 'docs/release-notes.md',
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  await main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

async function main(argv) {
  const options = parseVersionArgs(argv)
  const files = await readVersionFiles(repositoryRoot)

  if (options.set) {
    const next = applyAppVersion(files, options)

    for (const [key, content] of Object.entries(next)) {
      if (content !== files[key]) {
        await writeFile(path.join(repositoryRoot, VERSION_FILES[key]), content)
      }
    }

    const sources = readVersionSources(next)
    console.log(
      `[version] Set ${sources.packageVersion} (build ${sources.androidVersionCode}) in package.json, package-lock.json, Android and iOS.`,
    )

    if (sources.releaseNotesVersion !== sources.packageVersion) {
      console.log(
        `[version] Now add a "## v${sources.packageVersion} - YYYY-MM-DD" section to ${VERSION_FILES.releaseNotes}.`,
      )
    }

    return
  }

  const sources = readVersionSources(files)
  const problems = findVersionProblems(sources)

  if (problems.length > 0) {
    throw new Error(
      [
        '[version] App version sources disagree:',
        ...problems.map((problem) => `  - ${problem}`),
        '[version] Change versions only with npm run version:set (or mobile:release --version/--build).',
      ].join('\n'),
    )
  }

  console.log(
    `[version] ${sources.packageVersion} (build ${sources.androidVersionCode}): package.json, package-lock.json, Android, iOS and release notes agree.`,
  )
}

export function parseVersionArgs(argv) {
  const options = { build: undefined, set: false, version: undefined }

  for (const arg of argv) {
    if (arg === '--set') {
      options.set = true
    } else if (arg.startsWith('--version=')) {
      options.version = arg.slice('--version='.length)
    } else if (arg.startsWith('--build=')) {
      options.build = arg.slice('--build='.length)
    } else {
      throw new Error(`[version] Unknown option: ${arg}`)
    }
  }

  if (!options.set && (options.version || options.build)) {
    throw new Error('[version] --version and --build need --set.')
  }

  if (options.set && !options.version && options.build === undefined) {
    throw new Error('[version] Pass --version=X.Y.Z and/or --build=N.')
  }

  if (options.version !== undefined && !SEMVER_PATTERN.test(options.version)) {
    throw new Error(
      `[version] --version must look like 1.2.3: ${options.version}`,
    )
  }

  if (options.build !== undefined && !/^[1-9]\d*$/.test(options.build)) {
    throw new Error(
      `[version] --build must be a positive integer: ${options.build}`,
    )
  }

  return options
}

export async function readVersionFiles(root) {
  const entries = await Promise.all(
    Object.entries(VERSION_FILES).map(async ([key, relativePath]) => [
      key,
      await readFile(path.join(root, relativePath), 'utf8'),
    ]),
  )

  return Object.fromEntries(entries)
}

export function readVersionSources(files) {
  return {
    androidVersionCode:
      /^\s*versionCode\s+(\d+)\s*$/m.exec(files.androidGradle)?.[1] ?? null,
    androidVersionName:
      /^\s*versionName\s+"([^"]+)"\s*$/m.exec(files.androidGradle)?.[1] ?? null,
    iosBuildNumbers: [
      ...files.iosProject.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g),
    ].map((match) => match[1].trim()),
    iosMarketingVersions: [
      ...files.iosProject.matchAll(/MARKETING_VERSION = ([^;]+);/g),
    ].map((match) => match[1].trim()),
    packageLockVersions: readPackageLockVersions(files.packageLock),
    packageVersion: JSON.parse(files.packageJson).version ?? null,
    releaseNotesVersion:
      /^## v(\d+\.\d+\.\d+)\b/m.exec(files.releaseNotes)?.[1] ?? null,
  }
}

export function findVersionProblems(sources) {
  const problems = []
  const version = sources.packageVersion

  if (!SEMVER_PATTERN.test(version ?? '')) {
    problems.push(`package.json version must look like 1.2.3, got ${version}`)
  }

  for (const lockVersion of new Set(sources.packageLockVersions)) {
    if (lockVersion !== version) {
      problems.push(
        `package-lock.json version ${lockVersion} != package.json ${version}`,
      )
    }
  }

  if (sources.androidVersionName !== version) {
    problems.push(
      `Android versionName ${sources.androidVersionName} != package.json ${version}`,
    )
  }

  if (sources.iosMarketingVersions.length === 0) {
    problems.push('iOS MARKETING_VERSION entries not found')
  }

  for (const marketing of new Set(sources.iosMarketingVersions)) {
    if (marketing !== version) {
      problems.push(
        `iOS MARKETING_VERSION ${marketing} != package.json ${version}`,
      )
    }
  }

  if (!/^[1-9]\d*$/.test(sources.androidVersionCode ?? '')) {
    problems.push(
      `Android versionCode is missing or invalid: ${sources.androidVersionCode}`,
    )
  }

  if (sources.iosBuildNumbers.length === 0) {
    problems.push('iOS CURRENT_PROJECT_VERSION entries not found')
  }

  for (const build of new Set(sources.iosBuildNumbers)) {
    if (build !== sources.androidVersionCode) {
      problems.push(
        `iOS CURRENT_PROJECT_VERSION ${build} != Android versionCode ${sources.androidVersionCode}`,
      )
    }
  }

  if (sources.releaseNotesVersion !== version) {
    problems.push(
      `newest release notes section is v${sources.releaseNotesVersion}, expected v${version} (${VERSION_FILES.releaseNotes})`,
    )
  }

  return problems
}

export function applyAppVersion(files, { build, version }) {
  return {
    ...files,
    androidGradle: replaceAndroidVersion(files.androidGradle, {
      buildNumber: build,
      version,
    }),
    iosProject: replaceIosVersion(files.iosProject, {
      buildNumber: build,
      version,
    }),
    packageJson: version
      ? replacePackageVersion(files.packageJson, version)
      : files.packageJson,
    packageLock: version
      ? replacePackageLockVersion(files.packageLock, version)
      : files.packageLock,
  }
}

export function replacePackageLockVersion(content, version) {
  const topLevel = /^( {2}"version":\s*)"[^"]*"/m
  const rootPackage =
    /^( {4}"": \{\n {6}"name": "[^"]*",\n {6}"version":\s*)"[^"]*"/m

  if (!topLevel.test(content) || !rootPackage.test(content)) {
    throw new Error('Could not find the root "version" in package-lock.json.')
  }

  return content
    .replace(topLevel, `$1"${version}"`)
    .replace(rootPackage, `$1"${version}"`)
}

function readPackageLockVersions(content) {
  const lock = JSON.parse(content)

  return [lock.version ?? null, lock.packages?.['']?.version ?? null]
}

export function replacePackageVersion(content, version) {
  const pattern = /^( {2}"version":\s*)"[^"]*"/m

  if (!pattern.test(content)) {
    throw new Error('Could not find the top-level "version" in package.json.')
  }

  return content.replace(pattern, `$1"${version}"`)
}

export function replaceAndroidVersion(content, { version, buildNumber }) {
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

export function replaceIosVersion(content, { version, buildNumber }) {
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
