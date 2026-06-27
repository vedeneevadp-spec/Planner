import path from 'node:path'
import process from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'

import { npmCommand, npxCommand, runCommand } from './command-utils.mjs'
import { resolveMobileWebBuildEnv } from './mobile-web-build-env.mjs'

const [targetPlatform] = process.argv.slice(2)

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

  const cordovaPluginGradleFile = new URL(
    '../android/capacitor-cordova-android-plugins/build.gradle',
    import.meta.url,
  )
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

  let source

  try {
    source = await readFile(cordovaPluginGradleFile, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return
    }

    throw error
  }

  const updatedSource = source.replace(
    flatDirRepositoriesBlock,
    mavenRepositoriesBlock,
  )

  if (updatedSource === source) {
    return
  }

  await writeFile(cordovaPluginGradleFile, updatedSource)
  console.log('[mobile-sync] Removed generated Android flatDir repository.')
}
