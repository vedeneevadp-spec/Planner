import path from 'node:path'
import process from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { npmCommand, npxCommand, runCommand } from './command-utils.mjs'
import { resolveMobileWebBuildEnv } from './mobile-web-build-env.mjs'

const [targetPlatform] = process.argv.slice(2)
const androidGradlePluginVersion = '9.2.1'

if (targetPlatform && !['android', 'ios'].includes(targetPlatform)) {
  console.error(
    `Unknown mobile sync target: ${targetPlatform}. Use android, ios, or omit the argument.`,
  )
  process.exit(1)
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

async function main() {
  const { env, loadedEnvFile } = await resolveMobileWebBuildEnv({
    apiUrl: process.env.VITE_API_BASE_URL,
  })

  if (loadedEnvFile) {
    console.log(
      `[mobile-sync] Loaded auth config from ${path.relative(process.cwd(), loadedEnvFile)}`,
    )
  }

  await runCommand(npmCommand(), ['run', 'build'], { env })
  await runCommand(
    npxCommand(),
    targetPlatform ? ['cap', 'sync', targetPlatform] : ['cap', 'sync'],
    { env },
  )
  await normalizeAndroidGeneratedGradle(targetPlatform)
}

async function normalizeAndroidGeneratedGradle(platform) {
  if (platform && platform !== 'android') {
    return
  }

  const generatedGradleFiles = [
    '../android/capacitor-cordova-android-plugins/build.gradle',
    '../node_modules/@capacitor/android/capacitor/build.gradle',
    '../node_modules/@capacitor/app/android/build.gradle',
    '../node_modules/@capacitor/preferences/android/build.gradle',
    '../node_modules/@capacitor/push-notifications/android/build.gradle',
  ].map((gradleFilePath) => new URL(gradleFilePath, import.meta.url))

  for (const gradleFile of generatedGradleFiles) {
    await normalizeAndroidGradleFile(gradleFile)
  }
}

async function normalizeAndroidGradleFile(gradleFile) {
  let source

  try {
    source = await readFile(gradleFile, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return
    }

    throw error
  }

  const updatedSource = normalizeAndroidGradleSource(source)

  if (updatedSource === source) {
    return
  }

  await writeFile(gradleFile, updatedSource)
  console.log(
    `[mobile-sync] Normalized ${path.relative(process.cwd(), fileURLToPath(gradleFile))}.`,
  )
}

function normalizeAndroidGradleSource(source) {
  const flatDirRepositoriesBlock = `
repositories {
    google()
    mavenCentral()
    flatDir{
        dirs 'src/main/libs', 'libs'
    }
}
`
  const mavenRepositoriesBlock = `
repositories {
    google()
    mavenCentral()
}
`

  return source
    .replace(flatDirRepositoriesBlock, mavenRepositoriesBlock)
    .replace(
      /classpath 'com\.android\.tools\.build:gradle:[^']+'/g,
      `classpath 'com.android.tools.build:gradle:${androidGradlePluginVersion}'`,
    )
    .replace(/^(\s*)lintOptions\s*\{/gm, '$1lint {')
}
