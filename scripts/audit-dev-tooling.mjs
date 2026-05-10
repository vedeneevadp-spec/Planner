import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import process from 'node:process'

const allowedVulnerabilityNames = new Set([
  '@capacitor/assets',
  '@capacitor/cli',
  'tar',
])
const allowedNodePrefixes = [
  'node_modules/@capacitor/assets',
  'node_modules/@capacitor/assets/node_modules/@capacitor/cli',
  'node_modules/@capacitor/assets/node_modules/tar',
]
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)

const audit = await runNpmAudit()
const vulnerabilities = Object.values(audit.vulnerabilities ?? {})

if (vulnerabilities.length === 0) {
  console.log('Full npm audit is clean.')
  process.exit(0)
}

assertCapacitorAssetsIsDevOnly()

const unexpected = vulnerabilities.filter(
  (vulnerability) => !isAllowedDevToolingVulnerability(vulnerability),
)

if (unexpected.length > 0) {
  console.error('Unexpected npm audit vulnerabilities:')
  for (const vulnerability of unexpected) {
    console.error(
      `- ${vulnerability.name} (${vulnerability.severity}) via ${formatVia(vulnerability.via)}`,
    )
  }
  process.exit(1)
}

const critical = vulnerabilities.filter(
  (vulnerability) => vulnerability.severity === 'critical',
)

if (critical.length > 0) {
  console.error('Critical npm audit vulnerabilities are not allowed.')
  for (const vulnerability of critical) {
    console.error(`- ${vulnerability.name}`)
  }
  process.exit(1)
}

console.log(
  [
    'Only the known dev-only @capacitor/assets audit chain remains.',
    'Runtime dependencies are covered by npm run audit:prod.',
  ].join(' '),
)

async function runNpmAudit() {
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const { stdout } = await collect(npmBin, ['audit', '--json'])

  try {
    return JSON.parse(stdout)
  } catch (error) {
    throw new Error(`Failed to parse npm audit JSON: ${formatError(error)}`)
  }
}

function assertCapacitorAssetsIsDevOnly() {
  if (packageJson.dependencies?.['@capacitor/assets']) {
    throw new Error('@capacitor/assets must not be a production dependency.')
  }

  if (!packageJson.devDependencies?.['@capacitor/assets']) {
    throw new Error('@capacitor/assets devDependency was not found.')
  }
}

function isAllowedDevToolingVulnerability(vulnerability) {
  if (!allowedVulnerabilityNames.has(vulnerability.name)) {
    return false
  }

  if (vulnerability.fixAvailable) {
    return false
  }

  return (vulnerability.nodes ?? []).every((node) =>
    allowedNodePrefixes.includes(node),
  )
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
