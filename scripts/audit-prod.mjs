import { spawn } from 'node:child_process'
import process from 'node:process'

import { evaluateProductionAudit } from './audit-prod-policy.mjs'

const audit = await runNpmAudit()
const { unexpected } = evaluateProductionAudit(audit)

if (unexpected.length > 0) {
  console.error('Unexpected production npm audit vulnerabilities:')
  for (const vulnerability of unexpected) {
    console.error(
      `- ${vulnerability.name} (${vulnerability.severity}) via ${formatVia(vulnerability.via)}`,
    )
  }
  process.exit(1)
}

console.log('Production npm audit is clean.')

async function runNpmAudit() {
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const { stdout } = await collect(npmBin, ['audit', '--omit=dev', '--json'])

  try {
    return JSON.parse(stdout)
  } catch (error) {
    throw new Error(`Failed to parse npm audit JSON: ${formatError(error)}`)
  }
}

function formatVia(via) {
  return (via ?? [])
    .map((entry) => (typeof entry === 'string' ? entry : entry.name))
    .join(', ')
}

async function collect(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (stdout.trim()) {
        resolve({ code, stderr, stdout })
        return
      }

      reject(
        new Error(
          `${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}\n${stderr}`,
        ),
      )
    })
  })
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}
