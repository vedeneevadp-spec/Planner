import { spawn } from 'node:child_process'

function resolveCommand(baseName) {
  return process.platform === 'win32' ? `${baseName}.cmd` : baseName
}

export async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    env: options.env ?? process.env,
    stdio: 'inherit',
  })

  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Command failed with exit code ${code ?? 'unknown'}`))
    })
  })
}

export function npmCommand() {
  return resolveCommand('npm')
}

export function npxCommand() {
  return resolveCommand('npx')
}
