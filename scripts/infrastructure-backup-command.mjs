import { spawn } from 'node:child_process'

import { redactConnectionString } from './infrastructure-backup-helpers.mjs'

export async function runInfrastructureBackupCommand(
  command,
  args,
  options = {},
) {
  const capture = options.capture === true
  const child = spawn(command, args, {
    env: options.env ?? process.env,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  let stdout = ''
  let stderr = ''

  if (capture) {
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
  }

  await new Promise((resolve, reject) => {
    child.once('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(
          new Error(
            `${command} was not found. Install the required backup tool before enabling automation.`,
          ),
        )
        return
      }

      reject(error)
    })
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          `${formatInfrastructureBackupCommand(command, args)} failed with exit code ${code ?? 'unknown'}${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
        ),
      )
    })
  })

  return stdout.trim()
}

export function formatInfrastructureBackupCommand(command, args) {
  return [
    command,
    ...args.map((argument) =>
      looksLikeConnectionString(argument)
        ? redactConnectionString(argument)
        : argument,
    ),
  ].join(' ')
}

function looksLikeConnectionString(value) {
  return (
    typeof value === 'string' &&
    (value.startsWith('postgres://') || value.startsWith('postgresql://'))
  )
}
