import path from 'node:path'
import process from 'node:process'

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
}
