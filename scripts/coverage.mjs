import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const vitestEntrypoint = fileURLToPath(
  new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
)
const coverageProviderPath = new URL(
  '../node_modules/@vitest/coverage-v8',
  import.meta.url,
)
const forwardedArgs = process.argv.slice(2)

try {
  await access(coverageProviderPath, constants.F_OK)
} catch {
  console.error(
    [
      'Не найден пакет @vitest/coverage-v8.',
      'Выполните npm install, чтобы установить devDependencies, затем повторите npm run coverage.',
    ].join(' '),
  )
  process.exit(1)
}

const child = spawn(
  process.execPath,
  [vitestEntrypoint, 'run', '--coverage', ...forwardedArgs],
  {
    stdio: 'inherit',
    env: process.env,
  },
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
