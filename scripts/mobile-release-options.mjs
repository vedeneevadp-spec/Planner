export function parseArgs(args) {
  const options = {
    androidChannel: 'direct',
    androidAbiFilters: process.env.MOBILE_ANDROID_ABI_FILTERS
      ? parseAndroidAbiFilters(process.env.MOBILE_ANDROID_ABI_FILTERS)
      : undefined,
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

    if (arg.startsWith('--android-channel=')) {
      const value = arg.slice('--android-channel='.length)
      if (!['direct', 'googlePlay'].includes(value)) {
        throw new Error(
          'Invalid --android-channel value. Use direct or googlePlay.',
        )
      }
      options.androidChannel = value
      continue
    }

    if (arg.startsWith('--android-abi=')) {
      options.androidAbiFilters = parseAndroidAbiFilters(
        arg.slice('--android-abi='.length),
      )
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

  if (
    options.androidChannel === 'googlePlay' &&
    (options.buildArtifacts !== 'android' ||
      options.androidFormat !== 'bundle' ||
      !options.requireAndroidSigning)
  ) {
    throw new Error(
      'Google Play requires --build-artifacts=android --android-format=bundle --require-android-signing.',
    )
  }

  return options
}

export function parseAndroidAbiFilters(value) {
  const allowedAbis = new Set(['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'])
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (values.length === 0) {
    throw new Error(
      'Invalid --android-abi value. Use arm64-v8a, armeabi-v7a, x86, x86_64, or a comma-separated list.',
    )
  }

  for (const abi of values) {
    if (!allowedAbis.has(abi)) {
      throw new Error(
        'Invalid --android-abi value. Use arm64-v8a, armeabi-v7a, x86, x86_64, or a comma-separated list.',
      )
    }
  }

  return [...new Set(values)].join(',')
}

export function ensureUrl(value) {
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

export function parseBuildNumber(value) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Build number must be a positive integer: ${value}`)
  }

  return Number(value)
}

export function printHelp() {
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
  --android-channel=<channel>  direct (default) or googlePlay (signed Android AAB only).
  --android-abi=<abis>         Limit Android native ABIs, e.g. arm64-v8a for a physical phone APK.
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
